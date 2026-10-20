/* ===== JOB_QA: 70 câu hỏi kỹ thuật nhanh (trả lời miệng 2 phút) cho vị trí Full-stack Node.js · React · Next.js (OTSV / ONE) ===== */
window.JOB_QA = [
/* ---------- node (12) ---------- */
{ id: 'JQ1', topic: 'node', level: 1, q: `Explain the Node.js event loop. In what order do process.nextTick, a resolved Promise, setTimeout(0) and setImmediate run? — Giải thích event loop và thứ tự chạy của 4 loại callback này.`, a: `
- JS chạy trên **1 thread**; I/O được libuv giao cho kernel (socket) hoặc **threadpool** mặc định 4 thread ([[UV_THREADPOOL_SIZE]]) cho fs, dns.lookup, crypto, zlib.
- Các pha mỗi vòng: **timers** (setTimeout/setInterval) → pending callbacks → **poll** (chờ và chạy callback I/O) → **check** (setImmediate) → close callbacks.
- Sau **mỗi** callback, Node xả microtask: hàng [[process.nextTick]] trước, rồi **Promise** ([[then]], phần sau [[await]]).
- Thứ tự thường gặp: code đồng bộ → nextTick → Promise → setTimeout(0) / setImmediate. Từ main module hai cái cuối **không chắc chắn**; trong callback I/O thì setImmediate luôn chạy trước.
- Hệ quả thực tế: đệ quy nextTick hay chuỗi Promise vô tận có thể "bỏ đói" pha I/O.
EN: "Node runs JavaScript on a single thread; libuv handles I/O and the event loop moves through timers, poll and check phases, draining microtasks after every callback."` },

{ id: 'JQ2', topic: 'node', level: 2, q: `What happens if you block the event loop for 2 seconds? How would you detect and fix it? — Chặn event loop 2 giây thì chuyện gì xảy ra, phát hiện và sửa thế nào?`, a: `
- **Mọi** request trên process đó đứng 2 s, kể cả health check: timer trễ, socket timeout, liveness probe fail → Kubernetes/Cloud Run giết container, tải dồn sang instance khác và có thể lan.
- Thủ phạm hay gặp: [[JSON.parse]] payload vài chục MB, [[bcrypt.hashSync]], regex backtracking thảm hoạ (ReDoS), [[fs.readFileSync]], vòng lặp xử lý 100k phần tử trong request.
- Phát hiện: metric **event loop lag** bằng [[perf_hooks.monitorEventLoopDelay()]] (cảnh báo khi p99 > 100 ms), CPU profile [[node --cpu-prof]], clinic.js.
- Sửa: dùng API async, chia nhỏ việc và nhả loop bằng [[setImmediate]], đẩy CPU-bound sang **worker_threads**, việc dài thì đưa vào hàng đợi (Pub/Sub) cho worker riêng.
EN: "Blocking the loop for two seconds stalls every request on that process, including health checks, so I watch event-loop lag and move CPU-heavy work off the main thread."` },

{ id: 'JQ3', topic: 'node', level: 1, q: `Callbacks vs Promises vs async/await — and what happens to an unhandled promise rejection? — So sánh 3 kiểu async và chuyện gì xảy ra với promise bị reject không ai bắt?`, a: `
- Callback (error-first) dễ thành "callback hell", lỗi phải tự chuyền; **Promise** cho phép nối chuỗi, gom lỗi; **async/await** là cú pháp trên Promise, đọc như code tuần tự.
- [[try/catch]] chỉ bắt được lỗi của promise **đã await**. Quên [[await]] → lỗi rơi ra ngoài, hàm trả về trước khi việc xong.
- Từ Node 15, unhandled rejection mặc định **làm process crash** ([[--unhandled-rejections=throw]]) — tốt, vì nuốt lỗi im lặng nguy hiểm hơn.
- Bẫy hiệu năng: [[await]] trong vòng for chạy tuần tự; việc độc lập nên chạy song song có giới hạn.
- Bật lint [[@typescript-eslint/no-floating-promises]] để bắt promise "thả trôi".
EN: "async/await is just syntax over promises; the real risks are forgotten awaits and floating promises, which since Node 15 crash the process on rejection."` },

{ id: 'JQ4', topic: 'node', level: 2, q: `Promise.all vs allSettled vs race vs any — when do you use each, and how do you limit concurrency? — Khi nào dùng từng loại và giới hạn số việc chạy song song thế nào?`, a: `
- [[Promise.all]]: cần **tất cả** thành công, reject ngay khi 1 cái lỗi (fail-fast) — nhưng các promise còn lại **vẫn chạy**, không tự huỷ.
- [[Promise.allSettled]]: chạy hết, trả từng kết quả fulfilled/rejected — hợp cho batch "gửi 200 webhook, ghi lại cái nào lỗi".
- [[Promise.race]]: lấy cái **xong đầu tiên** (kể cả lỗi) — kiểu cài timeout; [[Promise.any]]: cái **thành công** đầu tiên, tất cả lỗi thì ném AggregateError — hợp gọi nhiều mirror.
- [[Promise.all]] trên 10 000 phần tử = 10 000 request cùng lúc → cạn connection pool, bị đối tác rate limit. Dùng **p-limit** hoặc chia batch 20–50.
- Huỷ thật sự cần [[AbortController]] truyền signal vào fetch/HTTP client.
EN: "I use all for must-succeed fan-out, allSettled for batches where partial failure is fine, and always cap concurrency with something like p-limit."` },

{ id: 'JQ5', topic: 'node', level: 3, q: `What are streams and backpressure? How would you export 2 million rows to CSV without running out of memory? — Stream và backpressure là gì, export 2 triệu dòng ra CSV mà không cạn RAM thế nào?`, a: `
- Stream xử lý dữ liệu **từng mảnh**: Readable, Writable, Duplex, Transform. **Backpressure**: khi bên ghi chậm, [[write()]] trả false → bên đọc phải dừng đến sự kiện [[drain]]; bỏ qua là buffer phình trong RAM.
- Dùng [[pipeline()]] từ [[node:stream/promises]]: tự lo backpressure, tự huỷ cả chuỗi và trả lỗi khi một mắt xích hỏng (pipe() thì không).
- Export: **DB cursor** (pg-query-stream hoặc keyset từng trang 5 000 dòng) → Transform sang CSV → gzip → response HTTP hoặc upload GCS. RAM gần như hằng số, chỉ vài MB buffer.
- Tránh: OFFSET pagination (càng về sau càng chậm), [[findAll()]] rồi [[join()]] cả file trong RAM, join FDW trong query export.
- Kể chuyện thật: export SBOM cũ dùng OFFSET + ReadAll, tốn RAM và chậm; viết lại theo cursor + stream là đúng hướng.
EN: "I'd stream rows from a database cursor through a CSV transform into the response with pipeline, so memory stays flat regardless of row count."` },

{ id: 'JQ6', topic: 'node', level: 3, q: `When would you use worker_threads vs child_process vs cluster? — Khi nào dùng worker_threads, child_process, cluster?`, a: `
- **worker_threads**: việc **CPU-bound** trong cùng process (parse file EDI lớn, nén, tính toán); mỗi worker có V8 isolate riêng, giao tiếp bằng message, có thể chia sẻ [[SharedArrayBuffer]]. Dùng **pool** (piscina) vì khởi động worker tốn hàng chục ms.
- **child_process**: chạy **chương trình khác** (ffmpeg, script Python, CLI) hoặc cô lập code dễ crash; tốn RAM hơn, giao tiếp qua stdio/IPC.
- **cluster**: fork N process cùng lắng nghe 1 port để dùng hết core cho HTTP. Trong container thường **không cần**: chạy 1 process/container, scale bằng replica.
- Không dùng worker cho I/O-bound — event loop đã làm việc đó tốt; worker chỉ thêm chi phí.
EN: "worker_threads are for CPU-bound work inside one service, child_process for running other programs, and in containers I scale with replicas instead of cluster."` },

{ id: 'JQ7', topic: 'node', level: 3, q: `How do you find a memory leak in a Node.js service running in production? — Tìm memory leak trong service Node trên production thế nào?`, a: `
- Dấu hiệu: [[heapUsed]] tăng dần qua nhiều chu kỳ GC (răng cưa có xu hướng đi lên), cuối cùng **OOMKilled** hoặc "JavaScript heap out of memory".
- Thủ phạm hay gặp: [[Map]]/cache module-level không giới hạn, listener không gỡ (cảnh báo MaxListenersExceeded), [[setInterval]] không clear, closure giữ object lớn, promise treo không bao giờ resolve.
- Cách tìm: chụp **2–3 heap snapshot** cách nhau vài phút ([[--heapsnapshot-signal=SIGUSR2]] hoặc [[--inspect]]), dùng chế độ Comparison trong Chrome DevTools xem loại object nào tăng và ai giữ nó (retainers).
- Đặt [[--max-old-space-size]] khoảng 75% memory limit container và luôn đặt memory limit — tránh cả node bị kéo chết.
- Phân biệt leak với **tải dữ liệu không giới hạn**: worker SBOM OOM 5 GiB là do preload 490k dòng × 10 goroutine, không phải leak — sửa bằng phân trang/stream.
EN: "I confirm it's a real leak by watching heap after GC, then diff two heap snapshots to see which objects grow and what retains them."` },

{ id: 'JQ8', topic: 'node', level: 2, q: `How do you handle errors in an Express or NestJS application? — Xử lý lỗi trong ứng dụng Express/NestJS thế nào?`, a: `
- Tách **operational error** (timeout, validation, không tìm thấy, đối tác 503) → xử lý, map ra HTTP status; và **programmer error** (bug, undefined) → log rồi để process crash và restart sạch.
- NestJS: ném lỗi domain ([[CapacityExceededError]]), một **ExceptionFilter** global map sang 409/422..., trả body thống nhất (RFC 9457 Problem Details) kèm **correlation id**, không lộ stack trace.
- Express 4 không tự bắt lỗi của async handler — phải [[next(err)]] hoặc wrapper; Express 5 đã tự chuyển promise bị reject vào error middleware.
- [[process.on('uncaughtException')]]: chỉ log + flush rồi **exit**, không chạy tiếp ở trạng thái hỏng.
- Bọc lỗi giữ nguyên nhân gốc: [[new Error('save booking failed', { cause: err })]].
EN: "I separate operational errors, which I map to proper status codes in a global filter, from programmer errors, where the right move is to log and restart."` },

{ id: 'JQ9', topic: 'node', level: 2, q: `How does cluster mode or PM2 work, and why might you not need it on Kubernetes or Cloud Run? — Cluster/PM2 hoạt động thế nào, vì sao trên K8s/Cloud Run có thể không cần?`, a: `
- Process primary fork N worker ([[os.availableParallelism()]]), chia kết nối cho worker (round-robin trên Linux); PM2 cluster mode bọc cơ chế này, thêm tự restart, reload không downtime.
- Hệ quả: mỗi worker có **bộ nhớ riêng** → cache, session, rate limit, lịch cron in-memory không chia sẻ; socket.io cần sticky session + Redis adapter.
- Trên container platform: **1 process/container**, scale bằng số replica, request 1 vCPU/instance; Cloud Run còn có **concurrency** (mặc định 80 request/instance).
- Bài học thật: lịch gocron in-memory chạy trong nhiều bản sao hoặc bị redeploy giữa chừng → lỡ tick/chạy trùng; cần lock phân tán hoặc scheduler ngoài (Cloud Scheduler).
EN: "In containers I prefer one Node process per container and let the platform scale replicas, keeping state like sessions and schedules outside the process."` },

{ id: 'JQ10', topic: 'node', level: 1, q: `Explain semver ranges like ^ and ~, and why you commit package-lock.json. npm install vs npm ci? — Giải thích ^, ~, vì sao commit lockfile, khác nhau giữa npm install và npm ci?`, a: `
- Semver MAJOR.MINOR.PATCH: [[^1.4.2]] cho phép tới dưới 2.0.0; [[~1.4.2]] tới dưới 1.5.0; với 0.x thì [[^0.4.2]] chỉ tới dưới 0.5.0.
- **Lockfile** ghim cây phụ thuộc chính xác (cả transitive) + hash integrity → máy dev, CI, image prod cài **giống hệt nhau**.
- [[npm ci]]: cài đúng theo lockfile, xoá node_modules, **fail** nếu lockfile lệch package.json — dùng trong CI và Dockerfile. [[npm install]] có thể cập nhật lockfile — dùng khi dev đổi dependency.
- Vá lỗ hổng transitive bằng [[overrides]]; theo dõi bằng [[npm audit]], Dependabot/Renovate.
- Kể chuyện: nâng Next.js lên bản patch để vá lỗ hổng RCE — đọc changelog, chạy test, xem lockfile diff trước khi merge.
EN: "Ranges in package.json say what we accept; the lockfile says what we actually run, and CI uses npm ci so every build is reproducible."` },

{ id: 'JQ11', topic: 'node', level: 3, q: `How do you implement graceful shutdown for a Node service on Cloud Run or Kubernetes? — Cài graceful shutdown cho service Node trên Cloud Run/K8s thế nào?`, a: `
- Nền tảng gửi **SIGTERM** rồi chờ một khoảng (Kubernetes mặc định 30 s, Cloud Run ~10 s) trước SIGKILL.
- Trình tự: cho readiness fail → [[server.close()]] ngừng nhận kết nối mới, [[closeIdleConnections()]] → đợi request đang chạy xong → dừng consumer (ngừng pull, nack phần chưa xử lý) → đóng DB pool, Redis → flush log/trace → [[process.exit(0)]]. Đặt timeout cứng nhỏ hơn grace period.
- NestJS: [[app.enableShutdownHooks()]] + [[onModuleDestroy]] / [[beforeApplicationShutdown]].
- Bẫy: CMD [[npm start]] không chuyển tiếp signal đúng → chạy [[node dist/main.js]] trực tiếp hoặc dùng tini làm PID 1.
- Việc dài (job vài phút) phải **idempotent và resume được**, vì shutdown sẽ cắt ngang — Watchtower redeploy giữa job là ví dụ thật.
EN: "On SIGTERM I fail readiness, stop accepting new work, drain in-flight requests and consumers, close pools, and exit before the grace period ends."` },

{ id: 'JQ12', topic: 'node', level: 1, q: `In TypeScript, what is the difference between any, unknown and never — and how do you validate external input at runtime? — Khác nhau giữa any, unknown, never và kiểm tra dữ liệu ngoài lúc runtime thế nào?`, a: `
- Type của TS **bị xoá khi chạy**: annotation không bảo vệ được body HTTP, message Pub/Sub hay file EDI.
- [[any]] tắt kiểm tra (lây lan); [[unknown]] buộc phải **narrow** trước khi dùng; [[never]] dùng cho exhaustive check — thêm loại sự kiện mới mà quên xử lý thì compile lỗi.
- Runtime validation ở biên: **zod** ([[schema.parse(body)]] và suy ra type từ schema) hoặc **class-validator** với [[ValidationPipe({ whitelist: true, transform: true })]] trong NestJS.
- Bật [[strict]] và [[noUncheckedIndexedAccess]]; mô hình hoá sự kiện tracking bằng **discriminated union** theo trường [[eventCode]].
EN: "TypeScript types disappear at runtime, so I treat all external input as unknown and validate it at the boundary with a schema before it reaches business logic."` },

/* ---------- frontend (14) ---------- */
{ id: 'JQ13', topic: 'frontend', level: 1, q: `What makes a React component re-render, and why does the key prop matter in lists? — Điều gì làm component render lại, vì sao key quan trọng trong danh sách?`, a: `
- Render lại khi: **state** của nó đổi (so bằng [[Object.is]]), **component cha** render lại (con mặc định render theo dù props không đổi), **context** nó dùng đổi giá trị.
- Render chưa phải cập nhật DOM: React so cây ảo (reconciliation) rồi chỉ commit phần khác.
- [[key]] là **danh tính** của phần tử giữa các lần render. Dùng index làm key khi danh sách sắp xếp/chèn/xoá → state của ô input "dính" sang dòng khác, animation sai.
- Dùng id ổn định từ dữ liệu: số container, booking id. Đổi key có chủ đích để **reset** state của một component.
EN: "A component re-renders when its state, its parent or a context it reads changes; keys give list items a stable identity so React keeps state on the right row."` },

{ id: 'JQ14', topic: 'frontend', level: 2, q: `What are common useEffect pitfalls, and why does my effect run twice in development? — Bẫy hay gặp với useEffect, vì sao effect chạy 2 lần ở môi trường dev?`, a: `
- useEffect để **đồng bộ với hệ thống bên ngoài** (subscription, timer, DOM API), không phải để tính state dẫn xuất — cái đó tính thẳng trong render hoặc [[useMemo]].
- Thiếu dependency → **stale closure** (đọc giá trị cũ); dependency là object/hàm tạo mới mỗi render → chạy vô tận.
- Luôn có **cleanup**: [[clearInterval]], unsubscribe, [[AbortController.abort()]] cho fetch; thiếu cleanup gây race (response cũ ghi đè response mới khi người dùng gõ nhanh).
- Strict Mode ở dev cố ý mount → unmount → mount lại để lộ effect thiếu cleanup; production chỉ chạy 1 lần.
- Data fetching nên dùng Server Component hoặc TanStack Query thay vì tự viết trong effect.
EN: "I use effects only to sync with external systems, always return a cleanup, and Strict Mode's double run is a feature that exposes missing cleanups."` },

{ id: 'JQ15', topic: 'frontend', level: 3, q: `When do useMemo, useCallback and React.memo actually help, and when are they a waste? — Khi nào memo thật sự có ích, khi nào là lãng phí?`, a: `
- [[React.memo]] bỏ qua render khi props **bằng nông**; [[useMemo]] cache giá trị tính toán; [[useCallback]] giữ nguyên **danh tính hàm** — chỉ có ích khi truyền vào con đã memo hoặc làm dependency của effect.
- Lãng phí khi: tính toán rẻ, con không memo, hoặc props vẫn là object mới mỗi render → vừa tốn so sánh vừa rối code.
- Đo trước bằng **React DevTools Profiler**; sửa gốc thường hiệu quả hơn: đẩy state xuống thấp, truyền [[children]] thay vì render trong cha, tách context.
- Bảng 5 000 container: **virtualize** (TanStack Virtual) lợi hơn mọi memo.
- React Compiler (nếu dự án bật) tự memo hoá, giảm nhu cầu viết tay.
EN: "I profile first; memoization only pays off when a re-render is measurably expensive and the props are actually stable."` },

{ id: 'JQ16', topic: 'frontend', level: 2, q: `How do you decide where state lives: local, lifted, context, a global store, the URL, or server state? — Quyết định đặt state ở đâu thế nào?`, a: `
- Mặc định **local** ([[useState]]); nâng lên cha chung khi nhiều anh em cần.
- **URL search params** cho filter, sort, trang: chia sẻ link, back button đúng — rất hợp trang tra cứu lịch tàu/tracking.
- **Context** cho dữ liệu ít đổi (user, locale, theme); đổi giá trị context làm **mọi consumer** render lại.
- **Store** (Zustand, Redux Toolkit) cho state client phức tạp, cập nhật thường xuyên, cần selector.
- **Server state** (TanStack Query/SWR, hoặc Server Component) cho dữ liệu từ API: cache, dedupe, refetch, stale-while-revalidate. Sai lầm kinh điển: chép dữ liệu API vào Redux rồi tự đồng bộ.
EN: "I keep state as close to where it's used as possible, put shareable filters in the URL, and treat API data as server state with its own cache."` },

{ id: 'JQ17', topic: 'frontend', level: 2, q: `Server Components vs Client Components in the Next.js App Router — what can each do, and where do you put the boundary? — Server và Client Component làm được gì, đặt ranh giới ở đâu?`, a: `
- **Server Component** (mặc định trong App Router): chạy trên server, có thể [[async]], gọi DB/API nội bộ, đọc secret, **không gửi JS** xuống browser; không có state, effect, event handler, browser API.
- **Client Component** ([[use client]] ở đầu file): tương tác, hook, browser API; vẫn được SSR ra HTML lần đầu rồi **hydrate**.
- Props qua ranh giới phải **serializable** (không truyền hàm, class instance). Có thể truyền Server Component làm [[children]] cho Client Component.
- Đẩy [[use client]] xuống **lá** (nút, form, bản đồ), giữ layout và phần lấy dữ liệu ở server → bundle nhỏ.
- Mutation dùng Server Action hoặc route handler; import [[server-only]] trong module chứa secret để chặn lỡ tay đưa xuống client.
EN: "I keep data fetching and layout in Server Components and push the use client boundary down to the small interactive leaves."` },

{ id: 'JQ18', topic: 'frontend', level: 1, q: `SSR vs SSG vs ISR vs CSR — how would you choose a rendering strategy per page for a shipping customer portal? — Chọn chiến lược render cho từng trang của portal hãng tàu thế nào?`, a: `
- **SSG/ISR** cho trang public cần SEO, đổi chậm: lịch tàu theo tuyến, trang cảng — build sẵn, cache CDN, [[revalidate]] ví dụ 300 s.
- **SSR động** cho trang tracking theo số container: dữ liệu theo từng request, phải tươi; có thể stream phần chậm bằng [[Suspense]].
- **Dashboard đã đăng nhập**: render động theo user, **không** cache CDN công khai; phần tương tác (bảng lọc, biểu đồ) là client.
- **CSR** cho widget thuần tương tác sau đăng nhập (bộ lọc, kéo thả).
- Trade-off: độ tươi dữ liệu ↔ TTFB, chi phí server, khả năng cache.
EN: "I pick per page: static or ISR for public SEO pages, dynamic SSR for per-request data like tracking, and keep logged-in dashboards private and uncached at the CDN."` },

{ id: 'JQ19', topic: 'frontend', level: 3, q: `Explain caching in the Next.js App Router. Why is my page showing stale data after an update? — Caching trong App Router hoạt động thế nào, vì sao trang hiện dữ liệu cũ?`, a: `
- Các tầng: **request memoization** (cùng fetch trong 1 lần render chỉ gọi 1 lần), **Data Cache** (kết quả fetch giữ qua nhiều request), **Full Route Cache** (HTML + RSC payload của route tĩnh lúc build), **Router Cache** phía client (route đã ghé).
- Mặc định đổi theo version: Next 14 cache fetch mặc định; Next 15+ **không** cache trừ khi opt-in ([[cache: 'force-cache']], [[next: { revalidate: 60 }]]); Next 16 có Cache Components với [[use cache]], [[cacheLife]], [[cacheTag]] — phải đọc docs đúng version dự án.
- Dữ liệu cũ thường do: route bị render **tĩnh lúc build** vì không dùng dynamic API, thiếu revalidate sau mutation, Router Cache phía client, hoặc CDN cache.
- Sửa: sau mutation gọi [[revalidateTag]]/[[revalidatePath]], [[router.refresh()]] ở client; trang cần luôn tươi thì đánh dấu dynamic.
EN: "There are four cache layers in the App Router, so for stale data I check whether the route was statically rendered and whether the mutation revalidates the right tag."` },

{ id: 'JQ20', topic: 'frontend', level: 2, q: `Why would a Next.js page hydrate with a mismatch, and how do you fix it? — Vì sao trang Next.js bị hydration mismatch và sửa thế nào?`, a: `
- Hydration = React gắn sự kiện vào HTML server render; mismatch khi **lần render đầu ở client khác HTML server**.
- Nguyên nhân hay gặp: [[new Date().toLocaleString()]] — server UTC, client giờ Việt Nam (hiển thị ETA!); [[Math.random()]]/uuid khi render; nhánh [[typeof window]]; đọc localStorage trong render; HTML lồng sai (div trong p, a trong a); extension hoặc **Google Translate** sửa DOM.
- Sửa: format ngày giờ với [[timeZone]] cố định ở cả hai phía hoặc trả chuỗi từ server; giá trị chỉ có ở client thì set sau mount ([[useEffect]]) hoặc [[dynamic(..., { ssr: false })]]; [[suppressHydrationWarning]] cho đúng một phần tử timestamp.
- Kể chuyện: dự án SBOM từng crash khi người dùng bật dịch trình duyệt vì DOM bị đổi dưới chân React.
EN: "A mismatch means the first client render differs from the server HTML, usually because of dates, randomness or browser-only values, so I make those deterministic or render them after mount."` },

{ id: 'JQ21', topic: 'frontend', level: 3, q: `What is Next.js middleware good for, and why does NEXT_PUBLIC_API_URL still point to localhost after you changed the env var on the server? — Middleware dùng cho việc gì, vì sao NEXT_PUBLIC_ vẫn là localhost dù đã đổi env?`, a: `
- Middleware (Next 16 đổi tên thành **proxy.ts**) chạy trước khi khớp route: redirect, rewrite, chuyển ngôn ngữ, chặn sớm khi thiếu cookie phiên, gắn header. Giữ **nhẹ**, dùng [[matcher]] bỏ qua static asset, không gọi DB nặng.
- Không coi middleware là lớp bảo mật duy nhất: năm 2025 từng có lỗ hổng bypass middleware bằng header nội bộ — vẫn phải kiểm tra quyền ở data layer/BFF.
- [[NEXT_PUBLIC_*]] được **inline vào JS bundle lúc next build**; đổi env lúc chạy container không có tác dụng. Biến không có prefix chỉ đọc được ở server, lúc runtime.
- Cách làm: build image theo môi trường, hoặc đọc env ở Server Component/route handler rồi truyền xuống, hoặc endpoint [[/config]] runtime.
- Kể chuyện: image FE bake endpoint [[localhost]] → 500 toàn site; phải rebuild, sửa env runtime vô ích.
EN: "NEXT_PUBLIC variables are baked into the bundle at build time, so runtime config must come from the server side or the image must be built per environment."` },

{ id: 'JQ22', topic: 'frontend', level: 1, q: `How do you build a responsive layout? Flexbox vs Grid, media queries vs container queries? — Làm layout responsive thế nào?`, a: `
- **Mobile-first**: CSS mặc định cho màn nhỏ, thêm [[@media (min-width: 768px)]] cho màn lớn.
- **Flexbox** cho bố cục một chiều (thanh công cụ, hàng nút); **Grid** cho hai chiều (khung dashboard, lưới thẻ với [[repeat(auto-fit, minmax(240px, 1fr))]]).
- **Container query** ([[@container]]) cho component tự thích nghi theo **khung chứa** (thẻ booking ở sidebar hay ở main), không theo cả màn hình.
- Đơn vị [[rem]], [[clamp()]] cho chữ co giãn; ảnh responsive ([[next/image]] với [[sizes]]); bảng nhiều cột trên mobile → chuyển dạng thẻ hoặc cuộn ngang có cột cố định.
- Kiểm tra bằng device mode và máy thật; nếu dùng Tailwind thì giữ đúng hệ breakpoint của team.
EN: "I design mobile-first, use flexbox for one-dimensional rows, grid for page layout, and container queries when a component must adapt to where it's placed."` },

{ id: 'JQ23', topic: 'frontend', level: 1, q: `What web accessibility basics do you check in a code review? — Khi review code bạn kiểm tra những gì về accessibility?`, a: `
- **HTML ngữ nghĩa**: [[button]] chứ không phải div có onClick, [[label]] gắn với input, heading đúng thứ bậc, landmark [[nav]]/[[main]].
- **Bàn phím**: tab được tới mọi thứ, focus nhìn thấy, Esc đóng modal, focus quay lại nút mở, không bẫy focus.
- **Nội dung**: alt text cho ảnh, độ tương phản WCAG AA 4.5:1 cho chữ thường, không truyền thông tin chỉ bằng màu (trạng thái container có chữ, không chỉ chấm đỏ/xanh).
- ARIA chỉ khi không có phần tử gốc; [[aria-live]] cho thông báo động ("Booking confirmed"), lỗi form nối bằng [[aria-describedby]].
- Công cụ: eslint-plugin-jsx-a11y, axe DevTools, [[@axe-core/playwright]] trong CI, thử nhanh bằng screen reader.
EN: "I start with semantic HTML and keyboard navigation, then check contrast and labels, and I run axe in CI so regressions are caught automatically."` },

{ id: 'JQ24', topic: 'frontend', level: 3, q: `What are Core Web Vitals, and how would you improve a page with a poor LCP and INP? — Core Web Vitals là gì, cải thiện LCP và INP kém thế nào?`, a: `
- Ba chỉ số, đánh giá ở **p75 dữ liệu thật**: **LCP** ≤ 2,5 s (phần tử lớn nhất hiện ra), **INP** ≤ 200 ms (độ trễ tương tác, thay FID từ 3/2024), **CLS** ≤ 0,1 (độ xô lệch layout).
- Lab (Lighthouse) để debug, field (CrUX, thư viện [[web-vitals]] gửi về RUM) để kết luận.
- LCP: giảm TTFB (ISR/CDN, cache BFF), không lazy-load ảnh hero mà preload nó, nội dung chính render ở server thay vì fetch ở client, font qua [[next/font]].
- INP: chia long task > 50 ms, giảm JS (Server Component, [[dynamic import]]), [[useTransition]] cho cập nhật nặng, virtualize bảng lớn, debounce ô tìm kiếm.
- CLS: khai báo width/height cho ảnh, giữ chỗ cho banner/skeleton.
EN: "I measure Web Vitals from real users at p75, then attack LCP through server rendering and caching, and INP by shipping less JavaScript and breaking up long tasks."` },

{ id: 'JQ25', topic: 'frontend', level: 1, q: `Explain CORS. Why does a preflight request fail, and how do you avoid CORS entirely? — Giải thích CORS, vì sao preflight fail, làm sao tránh hẳn CORS?`, a: `
- Browser áp **same-origin policy**; CORS là cách server **cho phép** origin khác đọc response qua [[Access-Control-Allow-Origin]].
- Request "không đơn giản" (JSON body, header [[Authorization]], PUT/DELETE) → browser gửi **preflight OPTIONS** trước; fail khi server không trả đúng Allow-Methods/Allow-Headers hoặc auth middleware chặn luôn OPTIONS.
- Có gửi cookie thì Allow-Origin **không được là [[*]]** và phải có [[Access-Control-Allow-Credentials: true]].
- CORS bảo vệ **người dùng trong browser**, không bảo vệ API: curl bỏ qua nó hoàn toàn.
- Tránh hẳn: FE gọi **BFF cùng origin** (Next route handler hoặc rewrite sang NestJS); nếu cần thì NestJS [[app.enableCors({ origin: allowList })]] và [[Access-Control-Max-Age]] để cache preflight.
EN: "CORS is the browser asking the server for permission; the cleanest fix is often to put a same-origin BFF in front so the browser never makes a cross-origin call."` },

{ id: 'JQ26', topic: 'frontend', level: 3, q: `Should a web app store its access token in localStorage or an httpOnly cookie? What does SameSite do, and how does XSS change the answer? — Lưu token ở đâu, SameSite làm gì, XSS ảnh hưởng thế nào?`, a: `
- **localStorage**: JS nào cũng đọc được → chỉ cần một lỗ **XSS** là token bị lấy mang đi dùng ở nơi khác.
- **Cookie httpOnly + Secure**: JS không đọc được, nhưng browser tự gửi kèm → nguy cơ **CSRF**.
- **SameSite**: [[Strict]] không gửi cross-site; [[Lax]] (mặc định của Chrome khi không khai báo) chỉ gửi khi điều hướng GET cấp cao nhất; [[None]] bắt buộc Secure, cần cho iframe/luồng SSO cross-site.
- Khuyến nghị: **BFF** giữ access/refresh token ở server, browser chỉ có session cookie httpOnly SameSite=Lax + CSRF token cho thao tác ghi.
- XSS vẫn nguy hiểm kể cả với httpOnly (kẻ tấn công gửi request thay người dùng) → CSP, tránh [[dangerouslySetInnerHTML]], sanitize markdown bằng DOMPurify.
EN: "I keep tokens out of JavaScript reach behind a BFF with an httpOnly SameSite cookie, and still treat XSS as critical because it can act as the user."` },

/* ---------- api (6) ---------- */
{ id: 'JQ27', topic: 'api', level: 1, q: `Design REST endpoints for bookings and the containers on them. What conventions do you follow? — Thiết kế endpoint REST cho booking và container, theo quy ước nào?`, a: `
- Tài nguyên là **danh từ số nhiều**: [[GET /bookings]], [[POST /bookings]], [[GET /bookings/{id}]], [[GET /bookings/{id}/containers]], [[GET /containers/{containerNo}/events]]; lồng tối đa 2 cấp.
- Lọc, sắp xếp, phân trang qua query: [[?status=CONFIRMED&voyage=FE123W&sort=-createdAt&limit=50]].
- Hành động nghiệp vụ là **chuyển trạng thái**: [[POST /bookings/{id}/cancellation]] hoặc [[PATCH]] trạng thái có kiểm tra hợp lệ — tránh [[/cancelBooking]].
- Đúng ngữ nghĩa method: GET an toàn, PUT/DELETE idempotent, POST không. Thời gian ISO 8601 kèm offset (ETA theo giờ cảng!), JSON camelCase thống nhất.
- Lỗi một định dạng duy nhất: **RFC 9457 Problem Details** ([[type]], [[title]], [[status]], [[detail]]).
EN: "I model nouns as resources, express business actions as state transitions, and keep filtering, errors and timestamps consistent across every endpoint."` },

{ id: 'JQ28', topic: 'api', level: 1, q: `Which HTTP status codes do you use for create, async processing, validation errors, auth failures, conflicts and rate limits? — Dùng status code nào cho từng tình huống?`, a: `
- **2xx**: 200 OK; **201 Created** + header Location; **202 Accepted** cho việc chạy nền (trả job id); 204 No Content.
- **4xx**: 400 request sai cú pháp; 422 dữ liệu hợp lệ cú pháp nhưng sai nghiệp vụ (tuỳ quy ước team); **401** chưa xác thực vs **403** đã xác thực nhưng không có quyền; 404; **409 Conflict** (hết chỗ, trùng, xung đột version); 412 khi If-Match sai; **429** + Retry-After.
- **5xx**: 500 lỗi của mình; 502/504 upstream hỏng hoặc chậm; 503 tạm quá tải/bảo trì.
- Bẫy: trả 200 kèm [[{ success: false }]]; trả 403 cho tài nguyên của tenant khác làm lộ là nó tồn tại → thường trả 404.
EN: "I use status codes so clients can react without parsing messages: 409 for business conflicts, 429 with Retry-After for throttling, and 404 rather than 403 for other tenants' resources."` },

{ id: 'JQ29', topic: 'api', level: 2, q: `A client retries POST /bookings after a timeout. How do you make sure it doesn't create a duplicate booking? — Client retry POST /bookings sau timeout, làm sao không tạo booking trùng?`, a: `
- Client gửi header **Idempotency-Key** (UUID sinh 1 lần cho mỗi thao tác logic, giữ nguyên khi retry).
- Server lưu bảng [[idempotency_keys(key, customer_id, request_hash, status, response, created_at)]] với **UNIQUE(customer_id, key)**, ghi **cùng transaction** với booking.
- Retry cùng key → trả lại response đã lưu; cùng key nhưng body khác → 422; hai request cùng key chạy song song → một bên thắng INSERT, bên kia nhận 409 "đang xử lý" hoặc chờ.
- TTL 24 h; ngoài ra dùng khoá nghiệp vụ tự nhiên (số tham chiếu khách gửi) làm unique constraint như lưới cuối.
- Ở phía consumer message cũng vậy: dedup theo event id, vì Pub/Sub giao **at-least-once**.
EN: "Every retryable write takes an idempotency key stored in the same transaction as the booking, so a retry returns the original result instead of creating a second one."` },

{ id: 'JQ30', topic: 'api', level: 2, q: `Offset vs cursor pagination — which would you use for a list of 5 million tracking events? — Dùng offset hay cursor cho danh sách 5 triệu sự kiện?`, a: `
- **Offset/limit**: đơn giản, nhảy tới trang N được; nhưng [[OFFSET 1000000]] bắt DB đọc rồi bỏ 1 triệu dòng → càng sâu càng chậm, dữ liệu chèn thêm làm trùng/sót dòng giữa các trang.
- **Cursor (keyset)**: [[WHERE (event_time, id) < ($1, $2) ORDER BY event_time DESC, id DESC LIMIT 50]] với index composite → chi phí chỉ phụ thuộc limit, ổn định khi có dữ liệu mới; không nhảy trang tuỳ ý được.
- Cursor trả về dạng **opaque** (base64 của bộ khoá) để sau này đổi cách sắp xếp không vỡ client.
- [[COUNT(*)]] tổng số trên bảng lớn rất đắt → làm tuỳ chọn, ước lượng, hoặc chỉ "có trang sau không".
- Bài học thật: export SBOM dùng OFFSET nên chậm dần theo độ sâu; keyset sửa được gốc.
EN: "For large or append-heavy lists I use keyset pagination with an opaque cursor, because offset gets slower the deeper you go and skips rows when data changes."` },

{ id: 'JQ31', topic: 'api', level: 3, q: `How do you version an API used by external partners and evolve it without breaking them? — Version hoá API cho đối tác và thay đổi mà không làm vỡ họ thế nào?`, a: `
- Phân biệt **thay đổi cộng thêm** (thêm field tuỳ chọn, endpoint mới — không vỡ) với **breaking** (đổi tên/xoá field, đổi kiểu, thêm field bắt buộc, đổi ý nghĩa hoặc thêm giá trị enum mà client không chịu được).
- Đối tác bên ngoài: major version trên URL ([[/v1]], [[/v2]]) dễ nhìn, dễ route; header versioning gọn hơn nhưng khó debug.
- Yêu cầu client là **tolerant reader**: bỏ qua field lạ, xử lý được enum chưa biết.
- Ngừng hỗ trợ có kế hoạch: header [[Deprecation]]/[[Sunset]], đo lượng gọi từng version theo từng đối tác, thời gian chuyển đổi (giả định 6–12 tháng), báo trước qua kênh chính thức.
- Chặn breaking change trong CI bằng diff OpenAPI (oasdiff) hoặc contract test (Pact).
EN: "Additive changes ship in place; breaking changes get a new major version, a sunset date, and usage metrics per partner so we know who still needs migrating."` },

{ id: 'JQ32', topic: 'api', level: 2, q: `How do you keep API documentation and code in sync? Contract-first or code-first with NestJS? — Giữ tài liệu API khớp code thế nào, contract-first hay code-first?`, a: `
- **Code-first**: [[@nestjs/swagger]] + CLI plugin sinh OpenAPI từ DTO và decorator — nhanh, tài liệu luôn theo code; hợp API nội bộ.
- **Contract-first**: viết spec YAML trước, review với FE/đối tác, rồi sinh stub/client — hợp API cho đối tác vì thống nhất trước khi code.
- Dù cách nào: CI sinh spec, so với bản đã commit, **fail khi có breaking change**; publish Swagger UI/Redoc theo version.
- Sinh **typed client** cho FE ([[openapi-typescript]]) → backend đổi field thì FE lỗi lúc compile, không phải lúc chạy.
- Spec phải có ví dụ, schema lỗi, auth, giới hạn rate — đó là phần đối tác hỏi nhiều nhất.
EN: "The OpenAPI spec is generated or validated in CI, and the frontend client is generated from it, so a contract change can't slip through unnoticed."` },

/* ---------- db (10) ---------- */
{ id: 'JQ33', topic: 'db', level: 2, q: `How does a B-tree index work, and when will Postgres not use the index you created? — B-tree index hoạt động thế nào, khi nào Postgres không dùng index?`, a: `
- B-tree giữ khoá **đã sắp xếp**, tra cứu O(log n): vài chục triệu dòng chỉ 3–4 tầng, phục vụ [[=]], range, [[ORDER BY]].
- Index composite [[(customer_id, created_at)]] dùng được cho lọc customer_id (+ sort created_at), **không** dùng cho lọc riêng created_at (quy tắc tiền tố trái).
- Không dùng khi: bọc hàm quanh cột ([[lower(email)]] → cần expression index), [[LIKE '%abc']], ép kiểu ngầm, điều kiện trả quá nhiều dòng (planner chọn seq scan), statistics cũ (chạy [[ANALYZE]]).
- Luôn kiểm tra bằng [[EXPLAIN (ANALYZE, BUFFERS)]]; mỗi index làm chậm ghi và tốn chỗ.
- **Partial index** cho tập nóng: index các dòng pending trên bảng SBOM 696k dòng đưa query từ phút xuống ms.
EN: "I design composite indexes around the actual WHERE and ORDER BY, check the plan with EXPLAIN ANALYZE, and use partial indexes when queries only touch a hot subset."` },

{ id: 'JQ34', topic: 'db', level: 3, q: `Explain transaction isolation levels. What can go wrong at READ COMMITTED when two users book the last slots on a voyage? — Giải thích isolation level, chuyện gì xảy ra khi 2 người cùng đặt chỗ cuối?`, a: `
- **READ COMMITTED** (mặc định Postgres): mỗi câu lệnh thấy snapshot mới → hai transaction cùng đọc "còn 2 TEU", cùng ghi → **lost update / overbook**.
- **REPEATABLE READ** (snapshot isolation): phát hiện update đồng thời trên **cùng dòng** (lỗi serialization) nhưng vẫn có **write skew** khi kiểm tra tổng nhiều dòng rồi chèn dòng mới.
- **SERIALIZABLE** (SSI) chặn cả write skew, đổi lại phải **retry** khi gặp lỗi 40001.
- Cách thực dụng: một câu atomic [[UPDATE voyage_capacity SET used = used + 2 WHERE id = $1 AND used + 2 <= cap]] rồi kiểm tra rowCount; hoặc [[SELECT ... FOR UPDATE]] dòng capacity; hoặc cột version (optimistic).
- Giữ transaction **ngắn**, không bao giờ gọi API thanh toán bên trong transaction đang giữ lock.
EN: "At read committed a read-then-write check can oversell, so I push the check into a single conditional update or lock the capacity row, and keep the transaction short."` },

{ id: 'JQ35', topic: 'db', level: 1, q: `What is the N+1 query problem and how do you fix it with an ORM like TypeORM or Prisma? — N+1 query là gì, sửa thế nào trong ORM?`, a: `
- 1 query lấy danh sách + **N query** lấy quan hệ của từng phần tử: 50 booking → 51 query, mỗi query một round trip (~0,5–1 ms) cộng thêm thời gian parse.
- Hay xuất hiện với lazy relation hoặc [[await]] trong vòng lặp gọi repository.
- Sửa: eager load có chủ đích ([[relations]] trong TypeORM, [[include]] trong Prisma), hoặc gom một query [[WHERE booking_id = ANY($1)]] rồi ghép trong code; GraphQL dùng DataLoader.
- Phát hiện: log số query mỗi request, span trong APM, test assert số query.
- Bẫy ngược lại: eager load **mọi thứ** — worker SBOM preload 490k vulnerability làm OOM; chỉ lấy cột và quan hệ cần, có phân trang.
EN: "N+1 shows up as one query per row; I fix it with a single batched or joined query, but I'm equally careful not to eagerly load far more than the page needs."` },

{ id: 'JQ36', topic: 'db', level: 2, q: `Embed or reference in MongoDB? How would you model a Bill of Lading with its containers and tracking events? — Embed hay reference, mô hình hoá B/L, container, sự kiện thế nào?`, a: `
- Thiết kế theo **câu truy vấn**, không theo chuẩn hoá. **Embed** khi dữ liệu đọc cùng nhau, có giới hạn, thuộc về cha; **reference** khi không giới hạn, dùng chung, hoặc cập nhật độc lập.
- B/L: embed bên gửi/nhận, cargo line, danh sách container (vài chục) — 1 lần đọc ra cả chứng từ.
- Sự kiện tracking **tăng không giới hạn** → collection riêng, khoá [[containerNo]] + [[eventTime]], hoặc **bucket pattern** (1 document/container/tháng).
- Giới hạn document **16 MB**; mảng lớn dần còn làm update chậm và index phình.
- **Extended reference**: chép tên tàu, mã chuyến vào booking để khỏi [[$lookup]]; chấp nhận cập nhật lại khi đổi.
EN: "I embed what is read together and bounded, like the parties and containers on a B/L, and keep unbounded data like tracking events in their own collection."` },

{ id: 'JQ37', topic: 'db', level: 2, q: `How would you write a MongoDB aggregation to count containers by status for one voyage, and which index makes it fast? — Viết aggregation đếm container theo trạng thái của 1 chuyến và index nào giúp nhanh?`, a: `
- Pipeline: [[$match]] theo [[voyageId]] **đặt đầu tiên** → [[$group]] theo status với [[$sum: 1]] → [[$sort]]; chỉ [[$project]] trường cần.
- Index theo quy tắc **ESR**: Equality trước, Sort sau, Range cuối → [[{ voyageId: 1, status: 1 }]]; có thể là covered query, không cần đọc document.
- Kiểm tra [[explain('executionStats')]]: IXSCAN thay vì COLLSCAN, [[totalDocsExamined]] gần bằng [[nReturned]].
- Stage có giới hạn bộ nhớ 100 MB (cần allowDiskUse cho dữ liệu lớn); [[$lookup]] đắt, tránh trên đường nóng.
- Dashboard gọi liên tục thì dùng **read model** tính sẵn ([[$merge]] định kỳ hoặc cập nhật theo sự kiện).
EN: "I filter first with match so the index does the work, follow the equality-sort-range rule for the compound index, and verify with explain."` },

{ id: 'JQ38', topic: 'db', level: 1, q: `What do you use Redis for in a typical web backend? — Bạn dùng Redis cho những việc gì?`, a: `
- **Cache** cache-aside cho dữ liệu đọc nhiều (lịch tàu, tóm tắt tracking) với TTL.
- **Session store**, **rate limit** ([[INCR]] + [[EXPIRE]], hoặc sliding window bằng sorted set), **dedup ngắn hạn** ([[SET key 1 NX EX 86400]] theo event id).
- **Distributed lock** [[SET lock val NX PX 30000]] — có giới hạn (GC pause, failover), việc quan trọng cần fencing token hoặc constraint ở DB.
- Sorted set cho xếp hạng/hàng đợi ưu tiên; Pub/Sub (không lưu, mất khi không ai nghe) vs **Streams** (consumer group, ack).
- Lệnh chạy **tuần tự 1 thread** → từng lệnh atomic, script Lua cho chuỗi lệnh atomic; 1 node cỡ 100k ops/s.
EN: "Redis is my default for caching, rate limiting, sessions and short-lived dedup, but I don't make it the source of truth for business data."` },

{ id: 'JQ39', topic: 'db', level: 3, q: `Your Redis cache hits maxmemory. What happens, which eviction policy do you choose, and how do you avoid a cache stampede? — Redis chạm maxmemory thì sao, chọn eviction gì, tránh stampede thế nào?`, a: `
- Mặc định [[noeviction]]: lệnh ghi **trả lỗi OOM**, ứng dụng không chịu được lỗi đó sẽ gãy.
- Cache thuần: [[allkeys-lru]] hoặc [[allkeys-lfu]]; nếu dùng chung với lock/session thì [[volatile-lru]] (chỉ xoá key có TTL) — tốt hơn là **tách instance**.
- **Stampede**: key nóng hết hạn → hàng nghìn request cùng đánh DB. Chống: gom request (một người tải, người khác chờ — singleflight/lock ngắn), **TTL jitter**, làm mới sớm/stale-while-revalidate.
- Theo dõi [[evicted_keys]], hit ratio, [[used_memory]], big key/hot key.
- Cache phải **degrade được**: Redis không tới được thì vẫn phục vụ từ DB có giới hạn — Lambda SBOM mất REDIS_HOST rơi về localhost là ví dụ thiếu fail-safe và thiếu kiểm tra config lúc khởi động.
EN: "For a pure cache I use an LRU or LFU policy, add TTL jitter and request coalescing against stampedes, and make sure the app degrades gracefully if Redis is gone."` },

{ id: 'JQ40', topic: 'db', level: 3, q: `How would you model container tracking events in Cassandra? — Mô hình hoá sự kiện tracking container trong Cassandra thế nào?`, a: `
- Cassandra thiết kế **từ câu truy vấn**: mỗi query một bảng, denormalize là bình thường.
- Query chính "sự kiện của container X, mới nhất trước": [[PRIMARY KEY ((container_no, journey_id), event_time, event_id)]] với [[CLUSTERING ORDER BY (event_time DESC)]] — đọc một partition, đã sắp sẵn.
- Partition phải **có giới hạn** (khuyến nghị dưới ~100 MB): container sống 10–15 năm → thêm journey_id hoặc bucket năm vào partition key.
- [[event_id]] tất định (hash từ container, mã sự kiện, địa điểm, thời gian) → ghi trùng thành **upsert**, dedup tự nhiên; sự kiện đến trễ tự vào đúng vị trí nhờ clustering theo event_time.
- Query "theo booking/B/L" → bảng thứ hai [[events_by_booking]], ghi cả hai. Tránh [[ALLOW FILTERING]], secondary index cardinality cao, partition theo ngày (hot partition).
EN: "I start from the query: partition by container and journey so each lookup hits one bounded partition, cluster by event time descending, and use a deterministic event id so duplicates become upserts."` },

{ id: 'JQ41', topic: 'db', level: 3, q: `Explain tunable consistency in Cassandra. What does QUORUM mean with a replication factor of 3? — Giải thích tunable consistency, QUORUM với RF=3 nghĩa là gì?`, a: `
- **RF** = số bản sao mỗi partition (3); **consistency level** chọn theo từng query: ONE, QUORUM, LOCAL_QUORUM, ALL.
- QUORUM với RF=3 = **2 node** xác nhận. Quy tắc **R + W > RF** (2 + 2 > 3) → đọc thấy bản ghi mới nhất; ONE/ONE nhanh nhưng có thể đọc dữ liệu cũ.
- RF=3 + QUORUM chịu được **1 node chết** mà vẫn đọc/ghi được. Nhiều region: LOCAL_QUORUM để không chờ round trip liên vùng (~100–150 ms).
- Đồng bộ lại nhờ hinted handoff, read repair, và **repair định kỳ** (phải lên lịch, nếu không dữ liệu xoá có thể "sống lại").
- Xung đột giải bằng **last-write-wins** theo timestamp → lệch đồng hồ gây sai; lightweight transaction ([[IF NOT EXISTS]]) dùng Paxos, nhiều round trip, dùng tiết kiệm.
EN: "With RF 3, writing and reading at QUORUM means two of three replicas, so reads overlap writes and we still tolerate one node down."` },

{ id: 'JQ42', topic: 'db', level: 1, q: `SQL or NoSQL? How would you choose storage for bookings versus tracking events? — Chọn SQL hay NoSQL cho booking và sự kiện tracking?`, a: `
- **Booking**: cần transaction (capacity + booking + trạng thái thanh toán), ràng buộc, truy vấn quan hệ, báo cáo → **Postgres**.
- **Sự kiện tracking**: chủ yếu append, khối lượng lớn, truy theo khoá và thời gian, có thể cần multi-region → **Cassandra** khi quy mô đòi hỏi; trước đó Postgres partition theo tháng vẫn đủ.
- **MongoDB** hợp chứng từ cấu trúc thay đổi theo đối tác (payload EDI, B/L nhiều biến thể); **Redis** cho cache và dữ liệu ngắn hạn.
- Quyết định theo: access pattern, mức consistency, quy mô đo được, và **kỹ năng vận hành** của team — mỗi DB thêm vào là thêm backup, monitoring, on-call.
EN: "I default to Postgres for transactional data and only add a specialised store like Cassandra when an access pattern or scale requirement clearly justifies the operational cost."` },

/* ---------- testing (8) ---------- */
{ id: 'JQ43', topic: 'testing', level: 1, q: `What is the difference between unit, integration and end-to-end tests, and how do you balance them? — Khác nhau giữa unit, integration, e2e và cân bằng thế nào?`, a: `
- **Unit**: một hàm/class, phụ thuộc giả lập, vài ms mỗi test, chạy hàng nghìn — hợp logic nghiệp vụ (tính TEU, state machine trạng thái booking).
- **Integration**: module với **DB/queue thật** (Testcontainers), HTTP qua **Supertest** — bắt lỗi SQL, serialization, transaction, migration.
- **E2E**: qua browser (Playwright) xuyên hệ thống — chậm, dễ flaky, chỉ giữ vài **hành trình quan trọng** (đăng nhập → tạo booking → thấy xác nhận).
- Kim tự tháp truyền thống vs "testing trophy" (dồn trọng tâm vào integration) — chọn theo **độ tin cậy trên chi phí**.
- Giữa các service: **contract test** thay vì dựng cả hệ thống.
EN: "I put most business rules in fast unit tests, cover database and HTTP behaviour with integration tests on real dependencies, and keep only a handful of critical end-to-end journeys."` },

{ id: 'JQ44', topic: 'testing', level: 2, q: `What should and shouldn't you mock? How do you test a NestJS service that calls an external carrier API? — Nên và không nên mock gì, test service NestJS gọi API ngoài thế nào?`, a: `
- Mock thứ **mình không sở hữu** và không tất định: API đối tác, đồng hồ, random, gửi email — mock ở **biên** (interface adapter), không mock sâu các class nội bộ (test sẽ dính chặt vào cách cài đặt).
- NestJS: [[Test.createTestingModule({ providers: [...] })]] rồi [[overrideProvider(CarrierClient).useValue(fake)]].
- Test ở tầng HTTP bằng **nock** hoặc **MSW** để giả lập 500, timeout, response chậm, JSON hỏng — chính là các case hay làm sập production.
- **Không mock DB** trong test repository: dùng DB thật. [[jest.useFakeTimers()]] cho retry/backoff.
- Phân biệt stub (trả dữ liệu), mock (kiểm tra được gọi thế nào), fake (bản cài đặt nhẹ chạy được).
EN: "I mock at the boundaries I don't own, like partner APIs and the clock, and use real databases for anything involving SQL."` },

{ id: 'JQ45', topic: 'testing', level: 2, q: `Why use Testcontainers instead of an in-memory database or SQLite for integration tests? — Vì sao dùng Testcontainers thay vì DB in-memory/SQLite?`, a: `
- Testcontainers dựng **Postgres/Mongo/Redis thật** trong Docker cho bộ test → đúng dialect, constraint, JSONB, index, [[FOR UPDATE]], isolation level, migration.
- SQLite/in-memory hành xử khác (kiểu dữ liệu, lock, hàm) → test xanh nhưng production đỏ: niềm tin giả.
- Chi phí: vài giây khởi động mỗi container → dùng lại cho cả suite (mỗi worker một container), reset giữa các test bằng [[TRUNCATE]] hoặc rollback transaction.
- Chạy **migration thật** lúc đầu suite — chính là chỗ bắt lỗi kiểu "column does not exist" sau khi đổi schema.
- CI cần Docker (runner GitHub Actions có sẵn); ghim version image giống production.
EN: "Testcontainers gives me the same database engine and migrations as production, which catches the bugs an in-memory substitute would hide."` },

{ id: 'JQ46', topic: 'testing', level: 3, q: `Your Playwright end-to-end suite is flaky in CI. How do you make it reliable? — Bộ test Playwright flaky trên CI, làm sao cho ổn định?`, a: `
- Nguyên nhân hay gặp: chờ cứng [[waitForTimeout]], không chờ đúng điều kiện, test chia sẻ dữ liệu khi chạy song song, phụ thuộc thứ tự, animation, timezone/locale khác máy dev, gọi dịch vụ bên thứ ba.
- Sửa: **web-first assertion** tự retry ([[await expect(page.getByRole('row', { name: /ABCU1234565/ })).toBeVisible()]]), locator theo role/label thay vì CSS dài.
- **Dữ liệu riêng cho từng test** tạo qua API (id duy nhất), không phụ thuộc test trước; mock bên thứ ba bằng [[page.route]].
- Cố định [[timezoneId]], [[locale]] trong config; [[trace: 'on-first-retry']] để mở trace xem chuyện gì đã xảy ra.
- Retry chỉ là **tín hiệu**, không phải thuốc chữa: theo dõi tỉ lệ flaky, cách ly test flaky có hạn sửa; tái hiện bằng [[--repeat-each=20]].
EN: "Flakiness is usually shared state or time-based waits, so I isolate test data, rely on auto-retrying assertions, and use traces to fix root causes rather than adding retries."` },

{ id: 'JQ47', topic: 'testing', level: 1, q: `What is UAT, how is it different from QA testing, and how do developers support it? — UAT là gì, khác QA thế nào, dev hỗ trợ ra sao?`, a: `
- **UAT** (User Acceptance Testing): người dùng nghiệp vụ/khách xác nhận tính năng **giải quyết đúng nhu cầu** trên môi trường giống production, theo acceptance criteria.
- QA/system test: tester kiểm tra phần mềm **đúng spec**; UAT trả lời "đây có phải thứ chúng tôi cần không".
- Dev hỗ trợ: acceptance criteria rõ dạng Given/When/Then từ đầu, **dữ liệu test thực tế** (chuyến tàu, booking mẫu), môi trường staging ổn định, release note, kênh nhận phản hồi.
- Phân loại phản hồi: **bug** (sai so với tiêu chí) vs **change request** (yêu cầu mới) — thống nhất với PO trước khi nhận việc.
- Kinh nghiệm làm với khách Nhật: Q&A và xác nhận trên Backlog, sign-off rõ ràng trước khi release.
EN: "UAT is where the business confirms the feature solves their problem, so I prepare realistic data, clear acceptance criteria, and a fast loop to triage feedback into bugs or change requests."` },

{ id: 'JQ48', topic: 'testing', level: 2, q: `How do you build an automated regression suite the team actually trusts? What goes in it and when does it run? — Xây bộ regression tự động mà team tin dùng thế nào?`, a: `
- Nội dung: các **luồng nghiệp vụ chính** + **mỗi bug đã sửa có một test** tái hiện nó — để bug không quay lại (SBOM từng có ticket bị regression lần hai sau một merge).
- Phần lớn ở tầng **API/integration** (nhanh, ổn định); UI e2e chỉ vài smoke test.
- Lịch chạy: PR → unit + integration (dưới ~10 phút); merge main → full regression API; nightly → e2e đủ trình duyệt; trước release → smoke trên staging.
- Giữ niềm tin: luôn **xanh**, test flaky phải sửa hoặc cách ly trong vài ngày, dữ liệu test do suite tự tạo, báo cáo có xu hướng theo thời gian.
- Đo hiệu quả bằng **escaped defects** (lỗi lọt lên production), không bằng số lượng test.
EN: "Every fixed bug gets a regression test, most of the suite lives at the API level, and we treat a red or flaky suite as a production issue."` },

{ id: 'JQ49', topic: 'testing', level: 1, q: `Is 100% code coverage a good goal? What doesn't coverage tell you? — 100% coverage có phải mục tiêu tốt, coverage không cho biết điều gì?`, a: `
- Coverage đo **dòng/nhánh đã chạy**, không đo **hành vi đã được kiểm tra**: test không có assertion vẫn đạt 100%.
- Hữu ích làm **sàn** (ví dụ 70–80% cho logic domain) và chỉ ra vùng chưa test; **coverage trên dòng thay đổi** trong PR có ích hơn con số toàn repo.
- Branch coverage nói nhiều hơn line coverage; **mutation testing** (Stryker) đo test có bắt được lỗi thật không.
- Không đuổi coverage ở DTO, code sinh tự động, file cấu hình — biến chỉ số thành mục tiêu là bị "chơi" ngay.
EN: "Coverage tells me what code ran, not whether it was verified, so I use it as a floor and a diff check rather than a target."` },

{ id: 'JQ50', topic: 'testing', level: 3, q: `Do you practise TDD? Walk me through red-green-refactor on a real example, and when it doesn't fit. — Bạn có làm TDD không, ví dụ thực tế và khi nào không hợp?`, a: `
- Vòng **red → green → refactor**: viết test fail cho một hành vi nhỏ, code tối thiểu cho xanh, rồi dọn code khi đã có lưới an toàn.
- Ví dụ: tính sức chứa chuyến tàu — test "từ chối khi tổng TEU vượt cap × 1,05", rồi "container 40ft tính 2 TEU", rồi "huỷ booking trả lại chỗ"; mỗi bước một test.
- Rất hợp: logic domain thuần, parser (EDI), **sửa bug** (viết test tái hiện bug trước rồi mới sửa).
- Ít hợp: UI khám phá, spike công nghệ, yêu cầu còn mù mờ → spike nhanh, vứt đi, rồi viết lại có test.
- Trả lời trung thực: dùng TDD có chọn lọc, không giáo điều; lợi ích lớn nhất là ép thiết kế dễ test (inject phụ thuộc, hàm thuần).
EN: "I use TDD where the rules are clear, like capacity calculations and bug fixes, and I spike first when the problem itself is still being discovered."` },

/* ---------- devops (8) ---------- */
{ id: 'JQ51', topic: 'devops', level: 1, q: `Why use a multi-stage Dockerfile for a Node or Next.js app, and what goes into each stage? — Vì sao dùng Dockerfile multi-stage cho app Node/Next, mỗi stage chứa gì?`, a: `
- **deps**: copy [[package.json]] + lockfile trước rồi [[npm ci]] → layer được cache, chỉ cài lại khi dependency đổi.
- **build**: copy source, [[tsc]] hoặc [[next build]] (Next bật [[output: 'standalone']] để chỉ lấy server tối thiểu).
- **runtime**: base nhỏ ([[node:22-slim]] hoặc distroless), chỉ [[dist]] + production deps, chạy bằng user không phải root ([[USER node]]).
- Lợi ích: image nhỏ hơn nhiều lần (Next standalone thường còn vài trăm MB thay vì trên 1 GB), ít CVE, không mang build tool hay secret vào image cuối.
- Thêm [[.dockerignore]] (node_modules, .env, .git); secret lúc build dùng [[--mount=type=secret]], không dùng ARG; **ghim version** base image.
EN: "Multi-stage builds let me cache dependencies, compile in a full image, and ship only the runtime artefacts in a small non-root image."` },

{ id: 'JQ52', topic: 'devops', level: 2, q: `Walk me through the CI/CD pipeline you would build for a NestJS service. — Mô tả pipeline CI/CD bạn sẽ dựng cho một service NestJS.`, a: `
- **PR**: [[npm ci]] (có cache) → lint + typecheck → unit test → integration test (Testcontainers) → build → quét bảo mật (npm audit/SCA, secret scan, quét image) — mục tiêu dưới ~10 phút.
- **Merge main**: build image **một lần**, tag bằng git SHA, push Artifact Registry → deploy staging → chạy migration → smoke/e2e.
- **Production**: duyệt thủ công (nếu quy trình yêu cầu) → canary hoặc chia traffic → kiểm tra error rate/latency → 100% hoặc tự rollback.
- Nguyên tắc: **build once, promote** cùng artifact qua các môi trường; pipeline là code (YAML trong repo); CI xác thực cloud bằng **OIDC** thay vì key JSON.
- Công cụ: GitHub Actions/GitLab CI, hoặc Cloud Build + Cloud Deploy trên GCP.
EN: "Every PR gets lint, types, tests and scans in under ten minutes, and main builds one immutable image that is promoted from staging to production with automated checks."` },

{ id: 'JQ53', topic: 'devops', level: 2, q: `Compare rolling, blue-green and canary deployments. When do you use feature flags? — So sánh rolling, blue-green, canary, khi nào dùng feature flag?`, a: `
- **Rolling**: thay dần từng instance — rẻ, nhưng **hai version chạy song song** nên API và schema phải tương thích ngược.
- **Blue-green**: hai môi trường đầy đủ, chuyển traffic một lần — rollback tức thì, tốn gấp đôi tài nguyên trong lúc chuyển.
- **Canary**: 1% → 10% → 50% → 100% kèm cổng metric (error rate, p99) — phát hiện lỗi với ít người bị ảnh hưởng; cần monitoring tốt để quyết định.
- Cloud Run hỗ trợ sẵn **chia traffic giữa các revision** và revision gắn tag (URL riêng, 0% traffic) để test trước.
- **Feature flag** tách deploy khỏi release: bật theo khách/tenant, có **kill switch**; nhớ dọn flag cũ kẻo thành nợ kỹ thuật.
EN: "I deploy with canaries gated on error rate and latency, and use feature flags so turning a feature on is a business decision, not a deployment."` },

{ id: 'JQ54', topic: 'devops', level: 3, q: `Cloud Run or GKE for a set of NestJS services and a Next.js front end? What are the trade-offs? — Chọn Cloud Run hay GKE, trade-off là gì?`, a: `
- **Cloud Run**: container serverless, tự scale (cả về 0), revision + chia traffic, TLS có sẵn, **concurrency** mỗi instance (mặc định 80); đổi lại có cold start (giảm bằng min instances) và ít quyền kiểm soát hạ tầng.
- **GKE** (Autopilot/Standard): Kubernetes đầy đủ — worker chạy liên tục, stateful, service mesh, mạng tuỳ biến, GPU; đổi lại tốn công vận hành.
- Đối chiếu AWS: Cloud Run ≈ App Runner/ECS Fargate, GKE ≈ EKS, Pub/Sub ≈ SNS + SQS, Cloud SQL ≈ RDS, Secret Manager ≈ Secrets Manager.
- Chọn Cloud Run cho API HTTP stateless và Next.js; cân nhắc GKE khi có nhiều service cần nền tảng chung, consumer tải đều 24/7, hoặc tính năng Cloud Run không có.
- Thực tế nhiều team dùng cả hai: Cloud Run cho web/API, GKE hoặc worker riêng cho xử lý nền.
EN: "I'd start stateless HTTP services on Cloud Run for the low operational cost and move to GKE only when we need long-running workloads or platform features Cloud Run can't give us."` },

{ id: 'JQ55', topic: 'devops', level: 3, q: `How does Google Cloud Pub/Sub delivery work — ack deadline, at-least-once, ordering keys, dead-letter topics — and how do you make consumers safe? — Pub/Sub giao message thế nào và làm consumer an toàn ra sao?`, a: `
- Topic → nhiều **subscription**, mỗi subscription nhận một bản; pull hoặc push. Mặc định **at-least-once**: không ack trong **ack deadline** (mặc định 10 s, gia hạn được tới 600 s; client library tự gia hạn) thì giao lại.
- **Ordering key**: message cùng key giao theo thứ tự khi subscription bật ordering — throughput mỗi key bị giới hạn, chọn key như [[containerNo]] chứ không phải một key toàn cục.
- **Dead-letter topic** sau số lần giao tối đa (5–100) + retry policy exponential backoff; có cảnh báo khi DLQ có message.
- Consumer: **idempotent** (dedup theo event id bằng unique constraint), ack **sau khi** commit, phân biệt lỗi tạm (nack) với poison message (đưa DLQ).
- Phía publish: **outbox** — ghi event cùng transaction rồi relay publish; publish trước commit (sự cố audit log SBOM) làm consumer thấy dữ liệu chưa tồn tại.
EN: "Pub/Sub is at-least-once, so consumers are idempotent, ack only after commit, and poison messages go to a dead-letter topic after a bounded number of attempts."` },

{ id: 'JQ56', topic: 'devops', level: 2, q: `How do you manage secrets for services and CI pipelines? Where must they never end up? — Quản lý secret cho service và CI thế nào, chỗ nào tuyệt đối không được có?`, a: `
- **Không bao giờ** nằm trong git, image Docker, bundle frontend ([[NEXT_PUBLIC_*]]), log, output CI.
- Lưu ở **Secret Manager** (GCP) hoặc Vault; Cloud Run tham chiếu secret thành env hoặc volume, ghim version; quyền theo **service account** least privilege.
- CI xác thực bằng **Workload Identity Federation** (OIDC từ GitHub Actions), không có key JSON dài hạn.
- Xoay vòng: hỗ trợ **hai key hợp lệ cùng lúc** để đổi không downtime; quét secret bằng gitleaks/secret scanning.
- **Fail fast**: validate config lúc khởi động ([[@nestjs/config]] + schema) — thiếu biến là crash ngay, không âm thầm rơi về localhost như Lambda SBOM sau redeploy.
EN: "Secrets live in a secret manager, are injected at runtime through a least-privilege identity, and the service refuses to start if required config is missing."` },

{ id: 'JQ57', topic: 'devops', level: 3, q: `A deploy breaks production. How do you roll back — and what about the database migration that shipped with it? — Deploy làm hỏng production, rollback thế nào, còn migration DB thì sao?`, a: `
- Đường nhanh: chuyển traffic về **revision trước** ([[gcloud run services update-traffic --to-revisions=PREV=100]]) hoặc deploy lại image tag cũ — chỉ làm được khi tag **bất biến** (git SHA), không phải [[:latest]].
- Lỗi ở mức tính năng: tắt **feature flag**, không cần rollback.
- DB: migration phải **tương thích ngược** theo expand → migrate → contract, để code cũ chạy được trên schema mới; không xoá/đổi tên cột trong cùng release. Down migration hiếm khi an toàn khi đã có dữ liệu → thường **roll forward**.
- Dữ liệu đã hỏng: PITR hoặc script sửa có kiểm chứng.
- Đặt **tiêu chí rollback trước** (ví dụ error rate > 2% trong 5 phút) — không debug trên production khi khách đang lỗi. Bài học Watchtower kéo [[mongo:latest]]: không ghim version là không có đường lùi.
EN: "I roll back by shifting traffic to the previous immutable revision, and because migrations follow expand-and-contract, the old code still works against the new schema."` },

{ id: 'JQ58', topic: 'devops', level: 1, q: `What's the difference between liveness, readiness and startup probes, and what should each check? — Khác nhau giữa liveness, readiness, startup probe, mỗi loại nên kiểm tra gì?`, a: `
- **Liveness**: process có bị treo không → fail thì **restart**. Giữ thật rẻ, **không** kiểm tra DB — nếu không, DB chập chờn 10 s là mọi pod cùng restart, sự cố lan rộng.
- **Readiness**: có nhận traffic được lúc này không → fail thì bị **rút khỏi load balancer**; có thể kiểm tra nhẹ phụ thuộc thiết yếu, fail trong lúc khởi động và shutdown.
- **Startup**: cho app khởi động chậm (warm cache, migration) thời gian, tránh liveness giết nhầm lúc boot.
- NestJS dùng [[@nestjs/terminus]]; Cloud Run hỗ trợ startup và liveness probe.
- Bẫy với docker-compose: [[healthcheck]] chỉ đánh dấu unhealthy, Docker **không tự restart** container vì lý do đó.
EN: "Liveness asks whether the process is stuck, readiness asks whether it should get traffic right now, and I never make liveness depend on the database."` },

/* ---------- security (4) ---------- */
{ id: 'JQ59', topic: 'security', level: 2, q: `JWT vs server-side sessions — which would you use for a customer portal, and what are the pitfalls of JWT? — Dùng JWT hay session cho portal khách hàng, bẫy của JWT là gì?`, a: `
- **Session**: id ngẫu nhiên trong cookie httpOnly, trạng thái ở Redis → thu hồi tức thì, cookie nhỏ; đổi lại mỗi request tra store một lần (~1 ms).
- **JWT**: claim tự chứa có chữ ký, verify không cần tra DB → hợp service-to-service, API cho đối tác; nhưng **khó thu hồi** → access token ngắn (5–15 phút) + refresh token xoay vòng + denylist theo [[jti]] khi cần.
- Verify đủ: thuật toán cố định (không chấp nhận [[none]]), [[iss]], [[aud]], [[exp]]; payload chỉ base64, **không mã hoá** → không để dữ liệu cá nhân.
- Portal trên browser: SSO qua **OIDC**, BFF giữ token, browser chỉ có session cookie; API nội bộ nhận JWT ngắn hạn từ BFF.
- Kể chuyện: dcn_toolbox tự làm đăng nhập mật khẩu + TOTP cho nhiều service NestJS.
EN: "For a browser portal I prefer a server-side session behind a BFF, and I use short-lived JWTs between services where stateless verification matters."` },

{ id: 'JQ60', topic: 'security', level: 1, q: `What is the OWASP Top 10, and which items do you check in your own code? — OWASP Top 10 là gì, bạn kiểm tra mục nào trong code của mình?`, a: `
- Danh sách nhận thức về các rủi ro phổ biến nhất của web app, cập nhật vài năm một lần; đứng đầu là **Broken Access Control**.
- Access control: mọi endpoint kiểm tra **quyền theo chủ sở hữu/tenant** — [[GET /bookings/123]] của khách khác phải trả 404 (lỗi IDOR).
- Injection: query tham số hoá, validate input; cấu hình sai: header bảo mật, không lộ stack trace, CORS chặt.
- **Thành phần dễ tổn thương / chuỗi cung ứng phần mềm**: lockfile, [[npm audit]], ghim version, SBOM — chính là lĩnh vực hệ thống SBOM tôi đang làm.
- Xác thực yếu, SSRF (gọi URL do người dùng đưa), thiếu log/giám sát bảo mật.
EN: "Broken access control tops the list, so every handler checks ownership or tenant, and I treat dependencies as an attack surface, which is exactly what my SBOM work is about."` },

{ id: 'JQ61', topic: 'security', level: 2, q: `Explain SQL injection, XSS and CSRF, and the main defence for each. — Giải thích SQL injection, XSS, CSRF và cách phòng chính.`, a: `
- **SQL injection**: chuỗi input ghép vào SQL → query tham số hoá ([[WHERE id = $1]]) hoặc binding của ORM; tên cột trong [[ORDER BY]] lấy từ **allow-list**; user DB quyền tối thiểu.
- **XSS**: dữ liệu không tin cậy chạy như HTML/JS (stored, reflected, DOM). React escape mặc định, nhưng [[dangerouslySetInnerHTML]], [[href="javascript:..."]], render markdown là lỗ hổng → sanitize (DOMPurify) + **CSP**.
- **CSRF**: browser tự gửi cookie trong request cross-site → site độc kích hoạt [[POST /bookings/123/cancellation]]. Phòng: cookie **SameSite=Lax/Strict**, CSRF token, kiểm tra header Origin.
- Token gửi qua header [[Authorization]] thì không bị CSRF, nhưng lại dễ lộ hơn nếu có XSS.
EN: "Injection is solved by parameterisation, XSS by escaping, sanitising and a content security policy, and CSRF by SameSite cookies plus tokens on state-changing requests."` },

{ id: 'JQ62', topic: 'security', level: 3, q: `Can you hide an API key inside a React or Next.js front end? How do you call a paid third-party API safely? — Có giấu được API key trong front-end không, gọi API trả phí an toàn thế nào?`, a: `
- **Không**: mọi thứ gửi xuống browser là công khai — JS bundle, [[NEXT_PUBLIC_*]], source map, tab Network.
- Gọi qua **backend/BFF** (route handler, Server Action hoặc NestJS): key nằm ở env server/Secret Manager; BFF thêm xác thực người dùng, **rate limit theo user**, cache, log chi phí.
- Key bắt buộc ở client (Maps, analytics): giới hạn theo **domain/referrer**, phạm vi API, quota — coi như đã lộ.
- Chặn lỡ tay: [[import 'server-only']] trong module chứa secret; không phát hành source map công khai (upload riêng cho công cụ theo dõi lỗi); grep build output tìm chuỗi key trong CI.
- Lỡ lộ: **xoay key ngay**, xem log sử dụng, rồi mới tìm nguyên nhân.
EN: "Anything shipped to the browser is public, so secret keys stay behind a BFF that authenticates the user and rate-limits the call."` },

/* ---------- design (8) ---------- */
{ id: 'JQ63', topic: 'design', level: 1, q: `Explain the SOLID principles with an example from your own code. — Giải thích SOLID bằng ví dụ từ code của bạn.`, a: `
- **S**: một lý do để thay đổi — [[BookingService]] không tự format email; việc đó thuộc notification.
- **O**: mở rộng không sửa — thêm định dạng EDI của đối tác mới bằng một adapter mới, không thêm nhánh [[if/else]] vào parser chung.
- **L**: implementation giữ đúng hợp đồng — repository "chỉ đọc" mà ném lỗi khi gọi save là vi phạm.
- **I**: interface nhỏ, đúng nhu cầu — [[NotificationSender]] thay vì một interface khổng lồ cho mọi kênh.
- **D**: phụ thuộc abstraction — inject [[PaymentGateway]] qua token DI của NestJS, test thay bằng fake. Thực dụng: không trừu tượng hoá khi chỉ có một cách cài đặt và chưa thấy lý do đổi.
EN: "SOLID for me is mostly about isolating reasons to change and depending on interfaces at the boundaries, without abstracting things that have only one implementation."` },

{ id: 'JQ64', topic: 'design', level: 2, q: `Name a design pattern you have used recently. What problem did it solve and what did it cost? — Kể một design pattern bạn dùng gần đây, giải quyết gì, trả giá gì?`, a: `
- **Adapter**: chuẩn hoá EDI 315/IFTSTA, API terminal JSON và sự kiện nội bộ về một [[TrackingEvent]] chung — phần còn lại của hệ thống không biết nguồn nào.
- **Strategy**: chọn kênh thông báo (email, webhook, in-app) theo preference của khách tại runtime; thêm kênh = thêm class.
- **Decorator** (interceptor NestJS): retry, cache, đo thời gian quanh lời gọi mà không sửa service.
- **Outbox**, **Repository**, **Factory** (tạo parser theo loại message) cũng hay dùng.
- Cách kể ghi điểm: vấn đề → pattern → **chi phí** (thêm lớp gián tiếp, khó lần theo code) → khi nào không dùng. Từ Go sang TS: interface Go ngầm định, TS cần interface + injection token vì interface bị xoá lúc runtime.
EN: "I used an adapter per event source to normalise partner formats into one internal event, which kept the core logic independent of EDI quirks."` },

{ id: 'JQ65', topic: 'design', level: 3, q: `How would you structure a NestJS service using clean or hexagonal architecture? Where do ORM entities live? — Tổ chức service NestJS theo clean/hexagonal thế nào, entity ORM nằm ở đâu?`, a: `
- **Domain**: entity, value object ([[Teu]], [[ContainerNo]]), quy tắc nghiệp vụ — không import NestJS hay ORM.
- **Application**: use case ([[CreateBookingUseCase]]) + **port** (interface [[BookingRepository]], [[PaymentPort]]).
- **Infrastructure**: adapter cài đặt port — repository TypeORM/Prisma, HTTP client đối tác, publisher Pub/Sub. **Entity ORM nằm ở đây**, map sang domain model.
- **Interface**: controller, DTO, guard. Quy tắc phụ thuộc hướng **vào trong**; nối bằng custom provider [[{ provide: BOOKING_REPO, useClass: TypeOrmBookingRepository }]].
- Trả giá: boilerplate mapping. Thực dụng: áp đầy đủ cho lõi nghiệp vụ (capacity, booking), module CRUD đơn giản thì giữ phẳng.
EN: "I keep the booking rules in a framework-free domain layer behind ports, put ORM entities in infrastructure adapters, and only pay that mapping cost where the domain is genuinely complex."` },

{ id: 'JQ66', topic: 'design', level: 3, q: `How does dependency injection work in NestJS, and what are the costs of REQUEST-scoped providers? — DI trong NestJS hoạt động thế nào, REQUEST scope tốn gì?`, a: `
- IoC container dựng đồ thị module, resolve provider theo **token** (class hoặc string/symbol) qua constructor; module phải [[exports]] provider thì module khác mới inject được.
- Custom provider: [[useClass]], [[useValue]], [[useFactory]] (async, inject config), [[useExisting]]; phụ thuộc vòng phải [[forwardRef]] — thường là dấu hiệu thiết kế sai.
- Scope: **DEFAULT** (singleton, nên dùng gần như mọi nơi), **REQUEST** (instance mới mỗi request), **TRANSIENT** (mỗi nơi inject một instance).
- REQUEST scope **lan ngược** lên mọi provider phụ thuộc nó → tạo object mỗi request, chậm hơn, và không dùng tự nhiên được trong cron/consumer.
- Muốn mang request id/tenant: **AsyncLocalStorage** (nestjs-cls) với singleton. Bẫy: lưu dữ liệu request vào field của singleton → rò sang request khác chạy đồng thời.
EN: "I keep providers singleton and carry per-request context like tenant or correlation id in AsyncLocalStorage, because request scope bubbles up and costs an instantiation per request."` },

{ id: 'JQ67', topic: 'design', level: 2, q: `Describe the NestJS request lifecycle. Where do you put authentication, validation, logging and error mapping? — Mô tả vòng đời request trong NestJS, đặt auth, validation, logging, map lỗi ở đâu?`, a: `
- Thứ tự: **middleware** → **guard** → **interceptor** (trước) → **pipe** → handler → interceptor (sau) → **exception filter** khi có lỗi.
- **Guard**: xác thực/phân quyền (đọc metadata [[@Roles()]] qua Reflector, kiểm tra tenant).
- **Pipe**: validate và transform tham số ([[ValidationPipe]], [[ParseUUIDPipe]]).
- **Interceptor**: log thời gian, bọc response, cache, timeout — có cả trước và sau handler (RxJS).
- **Filter**: map lỗi domain sang HTTP status và body thống nhất. Gắn global, theo controller, hoặc theo route; transport microservice (Redis, NATS, Kafka, RabbitMQ, gRPC) dùng cùng cơ chế với [[RpcException]].
EN: "Guards decide whether the request may proceed, pipes shape and validate input, interceptors wrap the handler for cross-cutting concerns, and filters translate errors into responses."` },

{ id: 'JQ68', topic: 'design', level: 1, q: `What do you look for in a code review, and how do you give feedback? — Bạn xem gì khi review code và góp ý thế nào?`, a: `
- **Đúng**: edge case (rỗng, null, timezone, đồng thời, retry), xử lý lỗi, test có kiểm tra **hành vi**.
- **An toàn & hiệu năng**: phân quyền, validate input, N+1, query không giới hạn (bài học OOM 490k dòng), transaction dài.
- **Vận hành**: log/metric đủ để debug, tương thích ngược của API và migration.
- **Dễ đọc**: đặt tên, độ dài hàm, khớp kiến trúc chung; style để lint/prettier lo, review tập trung vào logic.
- Góp ý: hỏi thay vì ra lệnh, giải thích **vì sao**, ghi rõ [[nit]] hay **blocker**, khen chỗ làm tốt, phản hồi trong ngày; PR nhỏ (dưới ~400 dòng) để review thật sự.
EN: "I review for correctness, safety and operability first, leave style to tooling, and label comments as blocking or nit so the author knows what really matters."` },

{ id: 'JQ69', topic: 'design', level: 1, q: `How do you document code, APIs and technical decisions? — Bạn viết tài liệu cho code, API và quyết định kỹ thuật thế nào?`, a: `
- **README**: chạy local, chạy test, biến môi trường bắt buộc, cách deploy — người mới chạy được trong 30 phút.
- **ADR** (Architecture Decision Record): bối cảnh → quyết định → hệ quả → phương án đã loại; ngắn, đánh số, nằm trong repo.
- **API**: OpenAPI sinh từ code kèm ví dụ; **runbook** cho on-call: cảnh báo này nghĩa là gì, kiểm tra gì, lệnh nào.
- **Comment** giải thích *vì sao*, không lặp lại *cái gì*; TSDoc cho API công khai của module; sơ đồ dạng code (Mermaid/C4).
- Tài liệu là một phần **Definition of Done**, được review trong cùng PR với code.
EN: "I keep documentation next to the code: a runnable README, ADRs for decisions, generated API docs, and runbooks for anything that can page someone."` },

{ id: 'JQ70', topic: 'design', level: 3, q: `How do you decide between a modular monolith and microservices for a new product? — Chọn modular monolith hay microservices cho sản phẩm mới thế nào?`, a: `
- **Microservices**: deploy/scale độc lập, team tự chủ, cô lập lỗi; trả giá bằng lời gọi mạng, giao dịch phân tán (saga), observability, vận hành, khó chạy local.
- **Modular monolith**: một artifact, module ranh giới rõ (NestJS module, không truy cập bảng của module khác), transaction đơn giản; tách sau theo ranh giới **đã được chứng minh** (strangler fig).
- Tiêu chí: số team (Conway's law), độ rõ của domain, **khác biệt tải** (ingest tracking cường độ cao vs booking), yêu cầu release độc lập, năng lực platform.
- Ví dụ thật: hệ SBOM tách apiserver và worker vì tải khác hẳn nhau, không phải vì "microservices là chuẩn".
EN: "I start with a modular monolith with strict boundaries and split out a service only when a different scaling profile, team ownership or release cadence justifies the distributed-systems cost."` },
];
