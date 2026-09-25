

#include "../../hnswlib/hnswlib.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <iostream>
#include <iomanip>
#include <numeric>
#include <random>
#include <ratio>
#include <string>
#include <thread>
#include <vector>

std::vector<float> get_random_vector(int dim, unsigned seed = 42) {
  static thread_local std::mt19937 rng(seed);
  std::uniform_real_distribution<> distrib_real;
  std::vector<float> data(dim);
  for (int i = 0; i < dim; i++) {
      data[i] = distrib_real(rng);
  }
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
  std::vector<std::thread> threads_;
  std::atomic<int> id_generator_{0};

public:
  IndexBuilder(const Parameters& params, hnswlib::AlgorithmInterface<float>* index) :
    params_(params), index_(index) {
  }

  void start() {
    for (int i = 0; i < params_.threads_for_index_building; ++i) {
      threads_.emplace_back([this, i]() {
        for (;;) {
          int id = id_generator_++;
          if (id >= params_.num_elements) break;
          auto data = get_random_vector(params_.dim, 42 + i);
          index_->addPoint(data.data(), id);
        }
      });
    }
  }

  ~IndexBuilder() {
    for (auto& thread : threads_)
      thread.join();
  }

};

int main(int argc, char** argv) {
  int max_elements = 1e7;
  const Parameters params = parse_args(argc, argv, max_elements);
  if (params.num_elements == 0) {
    fprintf(stderr, "--num_elements is required\n");
    exit(EXIT_FAILURE);
  }
  if (params.search && params.num_elements < params.k) {
    fprintf(stderr, "--num_elements must be at least --k when searching\n");
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

  auto t1 = std::chrono::system_clock::now();
  {
    IndexBuilder builder(params, index);
    builder.start();
  }
  std::chrono::duration<float> index_build_duration = std::chrono::system_clock::now() - t1;
  std::cout << "index build took " << index_build_duration.count() << " seconds\n";
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
