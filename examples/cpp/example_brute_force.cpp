

#include "../../hnswlib/hnswlib.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <iostream>
#include <numeric>
#include <random>
#include <ratio>
#include <string>
#include <vector>

std::vector<float> get_random_vector(int dim) {
  static std::mt19937 rng(42);
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
  bool brute_force = true;
};

Parameters parse_args(int argc, char** argv, int max_elements) {
  Parameters params;
  for (int i = 1; i < argc; i += 2) {
    std::string option = argv[i];
    if (option == "--brute_force") {
      std::string value = i + 1 < argc ? argv[i + 1] : "";
      if (value != "true" && value != "false") {
        fprintf(stderr, "--brute_force must be true or false\n");
        exit(EXIT_FAILURE);
      }
      params.brute_force = value == "true";
      continue;
    }
    char* end = nullptr;
    long value = i + 1 < argc ? std::strtol(argv[i + 1], &end, 10) : 0;
    if (value <= 0 || value > max_elements || *end ||
        (option != "--dim" && option != "--num_elements")) {
      fprintf(stderr, "Usage: %s --num_elements N [--dim D] [--brute_force true|false]\n", argv[0]);
      exit(EXIT_FAILURE);
    }
    (option == "--dim" ? params.dim : params.num_elements) = static_cast<int>(value);
  }
  if (params.num_elements < params.dim) {
    fprintf(stderr, "--num_elements is required and must be at least --dim\n");
    exit(EXIT_FAILURE);
  }
  return params;
}

int main(int argc, char** argv) {
  int max_elements = 1e7;
  const Parameters params = parse_args(argc, argv, max_elements);
  hnswlib::L2Space l2_space(params.dim);
  hnswlib::AlgorithmInterface<float>* index;
  if (params.brute_force) {
    index = new hnswlib::BruteforceSearch<float>(&l2_space, max_elements);
  }
  else {
    index = new hnswlib::HierarchicalNSW<float>(&l2_space, max_elements);
  }

  for (int i = 0; i < params.num_elements; ++i) {
    auto data = get_random_vector(params.dim);
    index->addPoint(data.data(), i);
  }

  int trials = 1000;
  float* trial_durations_ms = new float[trials];
  for (int i = 0; i < trials; ++i) {
    auto t1 = std::chrono::system_clock::now();
    auto data = get_random_vector(params.dim);
    index->searchKnn(data.data(), params.dim);
    std::chrono::duration<float, std::milli> d = std::chrono::system_clock::now() - t1;

    trial_durations_ms[i] = d.count();
  }

  std::sort(trial_durations_ms, trial_durations_ms + trials);
  float total_duration_ms = std::accumulate(trial_durations_ms, trial_durations_ms + trials, 0);

  std::cout << "avg_ms=" << total_duration_ms/trials
    << ",p25=" << trial_durations_ms[trials/4]
    << ",p50=" << trial_durations_ms[trials/2]
    << ",p75=" << trial_durations_ms[3*trials/4] << std::endl;

  delete[] trial_durations_ms;
  delete index;

  return 0;

}
