💡 **What:**
Replaced `Array.from()` and `.sort()` with a single-pass `O(N)` search when polling the `StreetView` DOM for its largest canvas.

🎯 **Why:**
The old approach allocated a new array and performed an `O(N log N)` sort on every tick (multiple times per second via `MutationObserver` and `setInterval`). Since the code only needs to find the maximum element (the canvas with the largest area), we can avoid heap allocations entirely by iterating directly over the `HTMLCollection` and tracking the canvas with the maximum area. This reduces memory pressure and garbage collection overhead.

📊 **Measured Improvement:**
Using a local standalone Node.js benchmark mocking the `HTMLCollection` with 10 elements over 100,000 iterations:
- Old Approach (`Array.from` + `.sort`): ~353.75ms
- New Approach (Single-pass iteration): ~5.79ms
- Improvement: ~98.36% faster execution time.
