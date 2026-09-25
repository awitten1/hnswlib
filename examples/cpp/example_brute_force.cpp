

#include "../../hnswlib/hnswlib.h"
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <iostream>
#include <random>

float* get_random_vector(int dim) {
  static std::mt19937 rng;
  static std::once_flag of;
  std::call_once(of, [&]() {
      rng.seed(47);
  });
  std::uniform_real_distribution<> distrib_real;
  float* data = new float[dim];
  for (int i = 0; i < dim; i++) {
      data[i] = distrib_real(rng);
  }
  return data;
}

int main(int argc, char** argv) {
  int dim = 32;
  int max_elements = 1e7;
  hnswlib::L2Space l2_space(dim);
  hnswlib::AlgorithmInterface<float>* bf = new hnswlib::BruteforceSearch<float>(&l2_space, max_elements);

  if (argc < 2) {
    fprintf(stderr, "must pass in num_elements\n");
    exit(EXIT_FAILURE);
  }
  int num_elements = std::stoi(argv[1]);
  if (num_elements > max_elements) {
    fprintf(stderr, "num_elements must be less than %d", max_elements);
    exit(EXIT_FAILURE);
  }

  for (int i = 0; i < num_elements; ++i) {
    bf->addPoint(get_random_vector(dim), i);
  }

  for (int i = 0; i < 1000; ++i) {
    bf->searchKnn(get_random_vector(dim), dim);
  }

  return 0;

}

