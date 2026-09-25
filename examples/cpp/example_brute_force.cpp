

#include "../../hnswlib/hnswlib.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <mutex>
#include <iostream>
#include <iomanip>
#include <numeric>
#include <random>
#include <ratio>
#include <string>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

std::vector<float> get_random_vector(int dim) {
  static thread_local std::mt19937 rng(std::hash<std::thread::id>{}(std::this_thread::get_id()));
  std::uniform_real_distribution<> distrib_real;
  std::vector<float> data(dim);
  for (int i = 0; i < dim; i++) {
      data[i] = distrib_real(rng);
  }
  return data;
}

std::vector<float> get_random_perturbed_vector(const std::vector<float>& vec, float eps = 0.01) {
  std::vector<float> ret(vec);
  static thread_local std::mt19937 rng(std::hash<std::thread::id>{}(std::this_thread::get_id()));
  std::uniform_real_distribution<> distrib_real(-eps, eps);
  for (int i = 0; i < ret.size(); i++) {
    ret[i] += distrib_real(rng);
  }
  return ret;
}

std::vector<float> get_random_unit_vector(int dim) {
  static thread_local std::mt19937 rng(std::hash<std::thread::id>{}(std::this_thread::get_id()));
  std::normal_distribution<float> distribution(0.0f, 1.0f);
  std::vector<float> data(dim);
  double squared_norm = 0.0;
  for (int i = 0; i < dim; ++i) {
      data[i] = distribution(rng);
      squared_norm += static_cast<double>(data[i]) * data[i];
  }
  const float norm = static_cast<float>(std::sqrt(squared_norm));
  for (float& value : data) value /= norm;
  return data;
}

struct Parameters {
  int dim = 32;
  int num_elements = 0;
  int k = 1;
  bool brute_force = true;
  bool search = false;
  int threads_for_index_building = 1;
};

Parameters parse_args(int argc, char** argv, int max_elements);

class IndexBuilder {
  Parameters params_;
  hnswlib::AlgorithmInterface<float>* index_;
  hnswlib::labeltype label_offset_;
  std::vector<std::thread> threads_;
  std::atomic<int> id_generator_{0};
  bool time_ = true;
  std::chrono::system_clock::time_point t1_;
  std::chrono::system_clock::time_point t2_;
  bool joined_ = false;

  template<typename Callable>
  void start_impl(Callable c) {
    t1_ = std::chrono::system_clock::now();
    for (int i = 0; i < params_.threads_for_index_building; ++i) {
      threads_.emplace_back([this, c]() {
        for (;;) {
          int id = id_generator_++;
          if (id >= params_.num_elements) break;
          auto data = c(params_.dim);
          index_->addPoint(data.data(), label_offset_ + id);
        }
      });
    }
  }

public:
  IndexBuilder(const Parameters& params, hnswlib::AlgorithmInterface<float>* index,
               hnswlib::labeltype label_offset = 0) :
    params_(params), index_(index), label_offset_(label_offset) {
  }

  template<typename Callable>
  void start(Callable c) {
    start_impl(c);
  }

  void join() {
    joined_ = true;
    for (auto& thread : threads_) {
      thread.join();
    }
    t2_ = std::chrono::system_clock::now();
  }

  std::chrono::duration<float> get_build_duration() {
    return t2_ - t1_;
  }

};

int main(int argc, char** argv) {
  const int max_parameter_value = 100000000;
  const Parameters params = parse_args(argc, argv, max_parameter_value);
  if (params.num_elements == 0) {
    fprintf(stderr, "--num_elements is required\n");
    exit(EXIT_FAILURE);
  }
  // Three batches remain, plus the center used by the third batch.
  const size_t max_elements = 3 * static_cast<size_t>(params.num_elements) + 1;
  if (max_elements > static_cast<size_t>(max_parameter_value)) {
    fprintf(stderr, "--num_elements is too large for three batches and their hub\n");
    exit(EXIT_FAILURE);
  }
  if (params.search && max_elements < static_cast<size_t>(params.k)) {
    fprintf(stderr, "3 * --num_elements + 1 must be at least --k when searching\n");
    exit(EXIT_FAILURE);
  }
  hnswlib::L2Space l2_space(params.dim);
  hnswlib::AlgorithmInterface<float>* index;
  if (params.brute_force) {
    index = new hnswlib::BruteforceSearch<float>(&l2_space, max_elements);
  }
  else {
    index = new hnswlib::HierarchicalNSW<float>(&l2_space, max_elements);
  }

  // {
  //   std::vector<std::vector<float>> vectors(params.num_elements);
  //   std::generate(vectors.begin(), vectors.end(), [&params]() {
  //     return get_random_vector(params.dim);
  //   });
  //   std::atomic<int> i{0};
  //   IndexBuilder builder(params, index);
  //   builder.start([&vectors, &i](int) {
  //     return std::move(vectors[i++]); });
  //   builder.join();
  //   std::cout << "index build took " << builder.get_build_duration().count() << " seconds\n";
  // }

  // {
  //   auto vec = get_random_vector(params.dim);
  //   std::vector<std::vector<float>> vectors(params.num_elements);
  //   std::generate(vectors.begin(), vectors.end(), [&vec]() {
  //     return get_random_perturbed_vector(vec, 0.000001);
  //   });
  //   std::atomic<int> i{0};
  //   IndexBuilder builder(params, index, params.num_elements);
  //   builder.start([&vectors, &i](int) {
  //     return std::move(vectors[i++]); });
  //   builder.join();
  //   std::cout << "perturbed index build took " << builder.get_build_duration().count() << " seconds\n";
  // }

  {
    const hnswlib::labeltype hub_label = 2 * static_cast<hnswlib::labeltype>(params.num_elements);
    // Keep the hub within the existing cloud so graph search can reach it.
    std::vector<float> center(params.dim, 0.5f);
    std::vector<std::vector<float>> vectors(params.num_elements);
    std::generate(vectors.begin(), vectors.end(), [&center, &params]() {
      auto point = get_random_unit_vector(params.dim);
      for (int i = 0; i < params.dim; ++i) {
        point[i] += center[i];
      }
      return point;
    });
    std::atomic<int> i{0};
    // Insert the hub before timing the shell workload.
    index->addPoint(center.data(), hub_label);

    IndexBuilder builder(params, index, hub_label + 1);
    builder.start([&vectors, &i](int) {
      return std::move(vectors[i++]); });
    builder.join();
    std::cout << "single-hub shell build took "
              << builder.get_build_duration().count() << " seconds\n";
    // if (!params.brute_force) {
    //   auto* hnsw_index = static_cast<hnswlib::HierarchicalNSW<float>*>(index);
    //   size_t points_linked_to_hub = 0;
    //   for (int i = 0; i < params.num_elements; ++i) {
    //     hnswlib::tableint internal_id =
    //         hnsw_index->getInternalIdByLabel(hub_label + 1 + i);
    //     auto* links = hnsw_index->get_linklist0(internal_id);
    //     size_t degree = hnsw_index->getListCount(links);
    //     auto* neighbors = reinterpret_cast<hnswlib::tableint*>(links + 1);
    //     for (size_t j = 0; j < degree; ++j) {
    //       if (hnsw_index->getExternalLabel(neighbors[j]) == hub_label) {
    //         ++points_linked_to_hub;
    //         break;
    //       }
    //     }
    //   }
    //   std::cout << ",center_link_fraction="
    //             << static_cast<double>(points_linked_to_hub) / params.num_elements;
    // }
    // std::cout << "\n";
  }

  if (params.search) {
    int trials = 1000;
    float* trial_durations_ms = new float[trials];
    for (int i = 0; i < trials; ++i) {
      auto t1 = std::chrono::system_clock::now();
      auto data = get_random_vector(params.dim);
      index->searchKnn(data.data(), params.k);
      std::chrono::duration<float, std::milli> d = std::chrono::system_clock::now() - t1;

      trial_durations_ms[i] = d.count();
    }

    std::sort(trial_durations_ms, trial_durations_ms + trials);
    float total_duration_ms = std::accumulate(trial_durations_ms, trial_durations_ms + trials, 0.0f);

    std::cout << std::fixed << std::setprecision(2)
      << "trials=" << trials
      << ",total_duration_seconds=" << total_duration_ms / 1000.0f
      << ",avg_ms=" << total_duration_ms/trials
      << ",p25=" << trial_durations_ms[trials/4]
      << ",p50=" << trial_durations_ms[trials/2]
      << ",p75=" << trial_durations_ms[3*trials/4] << std::endl;

    delete[] trial_durations_ms;
  }
  delete index;

  return 0;

}



int parse_int(const char* text, int max_value) {
  char* end;
  long value = std::strtol(text ? text : "", &end, 10);
  if (value <= 0 || value > max_value || *end) {
    fprintf(stderr, "Expected an integer between 1 and %d\n", max_value);
    exit(EXIT_FAILURE);
  }
  return static_cast<int>(value);
}

bool parse_bool(const char* text) {
  std::string value = text ? text : "";
  if (value != "true" && value != "false") {
    fprintf(stderr, "Expected true or false\n");
    exit(EXIT_FAILURE);
  }
  return value == "true";
}

Parameters parse_args(int argc, char** argv, int max_elements) {
  Parameters params;
  for (int i = 1; i < argc; i += 2) {
    std::string option = argv[i];
    if (option == "--dim") {
      params.dim = parse_int(argv[i + 1], max_elements);
    } else if (option == "--num_elements") {
      params.num_elements = parse_int(argv[i + 1], max_elements);
    } else if (option == "--k") {
      params.k = parse_int(argv[i + 1], max_elements);
    } else if (option == "--brute_force") {
      params.brute_force = parse_bool(argv[i + 1]);
    } else if (option == "--search") {
      params.search = parse_bool(argv[i + 1]);
    } else if (option == "--threads_for_index_building") {
      params.threads_for_index_building = parse_int(argv[i + 1], max_elements);
    } else {
      fprintf(stderr, "Unknown parameter: %s\n", argv[i]);
      exit(EXIT_FAILURE);
    }
  }
  return params;
}
