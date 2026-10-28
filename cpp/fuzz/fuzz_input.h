#pragma once
/**
 * cpp/fuzz/fuzz_input.h
 * Carve typed values out of a libFuzzer input. Floats and doubles are taken
 * as raw bit patterns, so NaN, +-inf, denormals and -0 all reach the kernels
 * — exactly what a TypedArray from JS can hand them.
 */

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace sv_fuzz {

class Input {
public:
    Input(const uint8_t* data, size_t size) : data_(data), size_(size) {}

    template <typename T> T take() {
        T v{};
        const size_t n = size_ < sizeof(T) ? size_ : sizeof(T);
        if (n > 0) std::memcpy(&v, data_, n);
        data_ += n;
        size_ -= n;
        return v;
    }

    /** An int in [lo, hi]. */
    int range(int lo, int hi) {
        const auto span = static_cast<uint32_t>(hi - lo) + 1U;
        return lo + static_cast<int>(take<uint32_t>() % span);
    }

    /** `count` values of T; past the end of the input the rest are zero. */
    template <typename T> std::vector<T> many(size_t count) {
        std::vector<T> out(count);
        for (T& v : out) v = take<T>();
        return out;
    }

    [[nodiscard]] bool empty() const { return size_ == 0; }

private:
    const uint8_t* data_;
    size_t size_;
};

/** Abort (a libFuzzer crash) when an invariant the ABI documents is broken. */
inline void require(bool ok) {
    if (!ok) __builtin_trap();
}

} // namespace sv_fuzz
