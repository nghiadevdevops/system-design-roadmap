/* ===== Tab Job · OTS Full-stack — J1–J3: Node.js runtime, TypeScript backend, NestJS production ===== */
window.LESSONS_J1 = [
{ id: 'J1', type: 'job', topic: 'node', title: 'Node.js runtime cho người đến từ Go', time: '120 phút',
  goal: 'Giải thích được event loop (phase, microtask, nextTick), libuv thread pool, cách phát hiện và gỡ event loop bị chặn, backpressure, memory V8 và graceful shutdown; ánh xạ được goroutine/channel/context của Go sang công cụ tương đương trong Node.',
  md: `
### Vấn đề cần giải
Trong Go, một goroutine chạy vòng lặp CPU 200 ms thì scheduler vẫn chia CPU cho goroutine khác (async preemption từ Go 1.14), request khác gần như không bị ảnh hưởng. Trong Node, **toàn bộ JavaScript của một process chạy trên một thread**: một đoạn đồng bộ 200 ms làm **mọi** request (kể cả [[/health]]) chờ thêm 200 ms. Node vẫn giữ được hàng nghìn kết nối đồng thời vì I/O là non-blocking (epoll/kqueue/IOCP qua thư viện **libuv**), nhưng chỉ khi code của bạn không giữ thread quá lâu. Phỏng vấn Node mid–senior xoáy đúng điểm này: khi nào Node nhanh, khi nào nó chết đứng, và đo bằng gì.

### Event loop: các phase và hai hàng đợi ưu tiên
| Phase | Chạy gì | Ví dụ |
|---|---|---|
| timers | callback setTimeout/setInterval đã đến hạn | retry sau 500 ms |
| pending callbacks | một số callback I/O bị hoãn từ vòng trước | lỗi TCP kiểu ECONNREFUSED |
| poll | lấy sự kiện I/O mới, chạy callback; rảnh thì chờ ở đây | socket có dữ liệu, file đọc xong |
| check | callback setImmediate | việc muốn chạy ngay sau poll |
| close callbacks | sự kiện close | socket bị đóng |
Giữa **mỗi callback** (Node 11+), Node xả sạch hàng [[process.nextTick]] trước, rồi đến **microtask** (Promise.then, phần tiếp theo sau await). Timer, I/O, setImmediate là **macrotask** (lấy từng callback theo phase). Hệ quả: nextTick hoặc Promise đệ quy vô hạn **bỏ đói I/O** (microtask starvation) dù không có vòng lặp CPU nào.
~~~ts
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
// CommonJS: sync, nextTick, promise, rồi timeout/immediate (2 cái cuối KHÔNG đảm bảo thứ tự ở main module).
// Trong callback I/O: immediate luôn trước timeout. Trong ESM, promise có thể in trước nextTick (module chạy trong microtask).
~~~

### libuv thread pool: phần "song song" bị ẩn
Network I/O không dùng thread pool. Các thao tác dưới đây thì có, pool mặc định **4 thread** dùng chung cả process:
| Thao tác | Chạy ở đâu | Bẫy |
|---|---|---|
| socket TCP, HTTP server/client | kernel (epoll), không tốn thread | gần như không |
| [[fs.readFile]], [[fs.stat]]... | thread pool | đĩa chậm/NFS chiếm hết 4 thread |
| crypto.pbkdf2, scrypt (bản async) | thread pool | 4 lần hash mật khẩu cùng lúc là pool đầy |
| zlib gzip async | thread pool | export nén lớn tranh chỗ với fs |
| dns.lookup (mặc định của http.get) | thread pool (getaddrinfo) | DNS chậm làm HTTP outbound xếp hàng |
| [[readFileSync]], [[pbkdf2Sync]] | chính event loop | chặn toàn server |
Tăng bằng [[UV_THREADPOOL_SIZE=16]] (tối đa 1024), phải có **trước khi** pool được dùng lần đầu, tức là đặt trong env của container chứ không gán giữa chừng trong code.

### Vì sao chặn event loop là chết cả server
- **JSON.parse/stringify** chuỗi 150 MB: đồng bộ, cỡ giây, heap phình gấp vài lần kích thước file.
- **Regex thảm hoạ** (catastrophic backtracking, ReDoS): [[/^(a+)+$/]] trên 30 chữ "a" kèm một ký tự lạ ở cuối có thể chạy hàng giây. Regex lồng lượng từ + input người dùng = lỗ hổng DoS.
- **Vòng lặp CPU**: sort/dedupe 500k phần tử, tính diff trong handler, hash đồng bộ.
- Dây chuyền: [[/health]] không kịp trả lời → orchestrator restart container → tải dồn sang instance còn lại → sập theo.
~~~ts
import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 20 }); h.enable();
setInterval(() => {
  const p99ms = h.percentile(99) / 1e6; // nano giây -> mili giây
  if (p99ms > 100) logger.warn({ p99ms }, 'event loop lag cao');
  h.reset();
}, 10_000).unref();
~~~
- Metric **event loop lag** (prom-client có sẵn [[nodejs_eventloop_lag_seconds]]): p99 dưới ~50 ms là khoẻ, trên 100 ms là có đoạn code chặn.
- [[node --cpu-prof dist/main.js]] sinh file .cpuprofile, mở bằng Chrome DevTools xem flame graph; Clinic.js ([[clinic doctor]], [[clinic flame]]) phân biệt nhanh nghẽn I/O hay CPU.
- Nguyên tắc: một khối đồng bộ nên dưới ~10 ms; nặng hơn thì chia chunk (nhường bằng setImmediate), dùng stream parser, hoặc đẩy sang worker.

### worker_threads vs cluster vs nhiều container
| Cách | Bản chất | Dùng khi | Trả giá |
|---|---|---|---|
| worker_threads | nhiều V8 isolate trong 1 process, trao đổi bằng postMessage (copy) hoặc SharedArrayBuffer | việc CPU-bound: parse file lớn, nén, hash | khởi động vài chục ms, copy dữ liệu; nên dùng pool (piscina) |
| cluster | fork N process cùng nghe một port | nhiều core trên 1 VM, không có orchestrator | không chung state, mỗi process một heap |
| nhiều container/pod | 1 process mỗi container, LB phía trước | mặc định trên Kubernetes/Cloud Run | RAM nền mỗi process vài chục MB |
Khác Go: một binary Go dùng hết mọi core, một process Node chỉ dùng ~1 core cho JavaScript. Scale request = **thêm process**; worker_threads chỉ để gánh việc CPU.

### Streams và backpressure
Backpressure (áp lực ngược): bên ghi chậm thì bên đọc phải dừng. [[writable.write()]] trả false khi buffer vượt **highWaterMark** (16 KiB đến Node 20, 64 KiB từ Node 22; objectMode là 16 object). Dùng [[pipeline]] thay vì [[.pipe()]]: pipeline lan lỗi và destroy mọi stream, .pipe() thì không, dễ rò file descriptor.
~~~ts
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
export async function exportCsv(res: ServerResponse): Promise<void> {
  const rows = db.queryStream('SELECT ... ORDER BY id'); // Readable objectMode, đọc theo cursor
  await pipeline(rows, toCsvLine(), createGzip(), res); // client chậm thì ngừng kéo từ DB
}
~~~

### async/await: lỗi hay gặp
- **Quên await**: lỗi thoát khỏi try/catch thành unhandled rejection; từ Node 15 mặc định process **crash**. Bật lint [[@typescript-eslint/no-floating-promises]].
- [[items.forEach(async (x) => ...)]] không chờ gì cả; dùng for...of (tuần tự) hoặc Promise.all (song song).
- **Promise.all** fail-fast: reject ngay khi một promise lỗi nhưng các promise còn lại **vẫn chạy**, không bị hủy (khác errgroup.WithContext). Cần kết quả từng phần tử thì dùng **Promise.allSettled**. Promise.all trên 10 000 phần tử = 10 000 request cùng lúc; giới hạn bằng p-limit.
~~~ts
import pLimit from 'p-limit';
const limit = pLimit(8); // tương đương errgroup.SetLimit(8)
const results = await Promise.allSettled(
  coords.map((c) => limit(() => fetchLicense(c, { signal: AbortSignal.timeout(5_000) }))),
);
const failed = results.filter((r) => r.status === 'rejected'); // đánh dấu lỗi từng dòng, không vứt cả batch
~~~

### Memory và graceful shutdown
| Khía cạnh | Go | Node |
|---|---|---|
| Giới hạn | GOMEMLIMIT: **soft limit**, GC chạy dày hơn khi gần chạm | --max-old-space-size: **hard limit** cho old space, vượt là crash "JavaScript heap out of memory" |
| Phạm vi | toàn bộ heap Go | chỉ heap V8; Buffer/native nằm ngoài (external, arrayBuffers) |
| Gợi ý trong container | ~90% memory limit | ~70–75% memory limit, chừa chỗ cho Buffer |
| Công cụ | pprof heap | heap snapshot qua --inspect, [[--heapsnapshot-near-heap-limit=2]], process.memoryUsage() |
Leak hay gặp: closure giữ object lớn, Map làm cache không giới hạn, [[emitter.on]] thêm listener mỗi request (MaxListenersExceededWarning khi quá 10), setInterval không clear. Shutdown: Docker gửi SIGTERM, chờ 10 s (Kubernetes 30 s) rồi SIGKILL; chạy [[node dist/main.js]] trực tiếp hoặc qua tini, không qua [[npm start]] vì npm chuyển tiếp signal không ổn định.
~~~ts
process.once('SIGTERM', async () => {
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  await new Promise<void>((resolve) => server.close(() => resolve())); // ngừng nhận mới, chờ request dở
  await Promise.allSettled([pool.end(), redis.quit(), amqpConn.close()]);
  clearTimeout(force);
  process.exit(0);
});
~~~

### Bảng chuyển đổi Go sang Node
| Go | Node/TS | Ghi chú |
|---|---|---|
| goroutine | async function/Promise cho I/O; worker_threads cho CPU | Promise không phải thread, không song song CPU |
| channel | EventEmitter, async iterator (for await), stream | không có channel sẵn; backpressure dùng stream |
| context hủy/deadline | AbortController, AbortSignal.timeout(ms), AbortSignal.any([...]) | phải truyền signal tường minh xuống fetch, DB driver |
| context.Value (traceId, tenantId) | AsyncLocalStorage | nestjs-cls bọc sẵn cho NestJS |
| errgroup.SetLimit, semaphore | p-limit + Promise.allSettled | Promise.all không hủy phần còn lại |
| sync.Mutex | thường không cần; async-mutex khi có await xen giữa | race logic vẫn xảy ra giữa hai await |
| select + time.After | Promise.race + AbortSignal | nhớ abort nhánh thua |
| defer, panic/recover | try/finally, throw/try-catch | uncaughtException: log rồi exit, không chạy tiếp |

### Sai lầm hay gặp
- Nghĩ "async là song song": await chỉ nhường thread khi chờ I/O; code CPU trong async function vẫn chặn.
- Đọc cả file/response vào RAM thay vì stream; dùng .pipe() không xử lý lỗi.
- Bắt uncaughtException rồi chạy tiếp: state đã hỏng, phải log và exit để orchestrator restart.
- Đặt --max-old-space-size bằng đúng memory limit container: Buffer nằm ngoài heap nên container bị OOM-kill trước khi V8 kịp GC.
- server.close() nhưng keep-alive idle còn giữ (Node dưới 19 không tự đóng) nên shutdown treo đến SIGKILL.

### Nói thế nào trong phỏng vấn (EN)
- "Node runs all JavaScript on one thread, so any synchronous work over ~10 ms adds latency to every in-flight request." — Khối đồng bộ hơn ~10 ms cộng độ trễ cho mọi request đang chạy.
- "Network I/O is non-blocking, but fs, crypto, zlib and dns.lookup share a 4-thread libuv pool by default." — I/O mạng không chặn, nhưng fs/crypto/zlib/dns.lookup chung pool 4 thread.
- "I watch event loop lag p99 and profile with --cpu-prof before guessing." — Tôi theo dõi event loop lag p99 và profile trước khi đoán.
- "CPU-heavy parsing goes to worker_threads; to scale request handling I add processes behind a load balancer." — CPU nặng thì worker_threads; scale request thì thêm process sau LB.
- "Coming from Go, I map context cancellation to AbortSignal and errgroup limits to p-limit with allSettled." — Từ Go: context sang AbortSignal, errgroup sang p-limit + allSettled.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện chính (STAR)**: worker Go OOM 5 GiB vì Preload 490k dòng x 10 goroutine, container không có memory limit. Kể thêm "trong Node lỗi này còn tệ hơn": Promise.all không giới hạn + JSON.parse cả kết quả vừa crash "heap out of memory" vừa chặn event loop; cách đúng là cursor stream + pipeline + p-limit + memory limit có headroom.
- Sự cố FetchBatch nuốt lỗi (một coordinate làm hỏng cả batch): bản Node là Promise.allSettled + đánh dấu lỗi từng phần tử + AbortSignal.timeout cho mỗi call ra ClearlyDefined.
- Sự cố publisher RabbitMQ không reconnect: trong Node nghe sự kiện close/error của connection amqplib, reconnect có backoff, readiness check fail khi mất broker để không "im lặng nhiều ngày".
- Watchtower redeploy 30 s: nối sang graceful shutdown (SIGTERM, server.close, đóng pool, nack message dở) để không mất request giữa chừng.
- Luyện 1 (2 giờ): trong một service NestJS của dcn_toolbox, thêm endpoint cố tình JSON.parse chuỗi 100 MB; đo p99 bằng autocannon + monitorEventLoopDelay, rồi chuyển phần parse sang worker_threads (piscina) và so lại số.
- Luyện 2: chạy [[node --cpu-prof]] cho endpoint đó, mở flame graph trong Chrome DevTools, giữ ảnh chụp để kể "tôi tìm hot path thế nào".
- Luyện 3: viết lại đoạn thứ tự nextTick/Promise/setTimeout/setImmediate theo trí nhớ, chạy cả CommonJS và ESM, tự giải thích chênh lệch.
- Luyện 4: thêm handler SIGTERM vào ssh-monitor, đo thời gian [[docker stop]] trước/sau (10 s chờ SIGKILL so với dưới 1 s).
- Luyện 5: tự viết bảng Go sang Node trên một trang không nhìn tài liệu, rồi đọc to 5 câu EN ở trên cho đến khi nói trôi trong 2 phút.
`,
  quiz: [
    { t: 'mc', q: 'File CommonJS gọi lần lượt setTimeout(0), setImmediate, Promise.then, process.nextTick và một console.log đồng bộ. Thứ tự nào chắc chắn đúng?', o: ['nextTick, sync, promise, timeout, immediate', 'sync, promise, nextTick, rồi timeout/immediate', 'sync, nextTick, promise, rồi timeout/immediate (hai cái cuối không đảm bảo thứ tự)', 'sync, timeout, immediate, nextTick, promise'], a: 2, why: 'Code đồng bộ chạy trước; sau đó Node xả hàng nextTick rồi microtask; timeout 0 và immediate ở main module phụ thuộc thời điểm vào vòng lặp.' },
    { t: 'mc', q: 'Thao tác nào KHÔNG dùng libuv thread pool?', o: ['fs.readFile', 'crypto.pbkdf2 bản async', 'dns.lookup', 'Đọc body request từ socket TCP của HTTP server'], a: 3, why: 'Network I/O dùng cơ chế non-blocking của kernel (epoll/kqueue/IOCP); fs, crypto, zlib, dns.lookup mới vào pool 4 thread.' },
    { t: 'mc', q: 'Khi một khách upload file SBOM 150 MB, p99 của mọi endpoint (kể cả /health) nhảy lên 3 s, một core CPU 100%, DB rảnh. Nguyên nhân khả dĩ nhất?', o: ['JSON.parse toàn bộ file đồng bộ trong handler chặn event loop', 'Connection pool Postgres bị cạn', 'Thread pool libuv quá nhỏ', 'Garbage collector của V8 bị tắt'], a: 0, why: 'Mọi endpoint chậm cùng lúc + một core ghim + DB rảnh là dấu hiệu event loop bị chặn bởi việc CPU đồng bộ.' },
    { t: 'mc', q: 'Promise.all([a, b, c]) và b reject sau 100 ms. Điều gì xảy ra với a và c?', o: ['Bị hủy tự động như errgroup.WithContext', 'Vẫn chạy đến khi xong, kết quả bị bỏ qua', 'Promise.all chờ cả ba xong rồi mới reject', 'Process crash vì unhandled rejection của a và c'], a: 1, why: 'Promise không có cơ chế hủy; muốn hủy phải truyền AbortSignal. Cần đủ kết quả từng phần tử thì dùng allSettled.' },
    { t: 'mc', q: 'So sánh --max-old-space-size của Node với GOMEMLIMIT của Go, câu nào đúng?', o: ['Cả hai đều là soft limit, chỉ làm GC chạy dày hơn', 'Nó giới hạn toàn bộ RSS của process, gồm cả Buffer', 'Nó là hard limit cho old space của V8; vượt thì process crash, Buffer không tính vào', 'Nên đặt bằng đúng memory limit của container'], a: 2, why: 'GOMEMLIMIT là soft limit; max-old-space-size là trần cứng chỉ cho heap V8, nên phải chừa chỗ cho external memory.' },
    { t: 'fill', q: 'Hàm ___ trong node:stream/promises nối nhiều stream, tôn trọng backpressure, lan lỗi và tự destroy mọi stream khi có lỗi.', a: ['pipeline', 'stream.pipeline'], why: '.pipe() không lan lỗi nên dễ rò file descriptor và treo request.' },
    { t: 'fill', q: 'Tương đương context.WithTimeout của Go khi gọi fetch trong Node: truyền signal: AbortSignal.___(5000).', a: ['timeout'], why: 'AbortSignal.timeout(ms) tạo signal tự abort; gộp nhiều signal bằng AbortSignal.any.' },
    { t: 'open', q: 'Service Node của bạn có endpoint import file lớn; mỗi lần có người import, toàn bộ API chậm và healthcheck fail. Bạn điều tra và sửa thế nào?', a: 'Trước hết xác nhận event loop bị chặn: metric event loop lag p99 tăng vọt, một core 100%, DB rảnh. Sau đó chạy --cpu-prof (hoặc clinic flame) để tìm hot path, thường là JSON.parse cả file hoặc vòng lặp đồng bộ trên hàng trăm nghìn phần tử. Sửa theo thứ tự: đọc bằng stream parser + pipeline để không giữ cả file trong heap, chia nhỏ việc CPU, đẩy phần parse sang worker_threads (pool như piscina) hoặc tách hẳn thành job trong queue cho worker riêng. Cuối cùng thêm alert event loop lag, giới hạn kích thước upload, và để liveness check không phụ thuộc việc nặng.', keys: ['event loop', 'cpu-prof', 'stream', 'worker_threads'] }
  ]
},
{ id: 'J2', type: 'job', topic: 'node', title: 'TypeScript cho backend production', time: '120 phút',
  goal: 'Cấu hình được tsconfig strict cho service Node, mô hình hoá domain bằng discriminated union và generics, validate runtime ở biên, phân biệt DTO/entity/domain type, chọn được cách xử lý lỗi (Result hay throw + cause), và giải thích build/lint/module/TSDoc khi bị hỏi.',
  md: `
### Vấn đề cần giải
Go có type ở cả compile time lẫn runtime: [[json.Unmarshal]] vào struct sai kiểu là có lỗi. TypeScript thì **type bị xoá hoàn toàn khi build** (type erasure): [[req.body as CreateBookingDto]] chỉ là lời hứa với compiler, runtime nhận gì chạy nấy. Cộng thêm hệ type **structural** (khớp hình dạng là gán được, không cần khai báo implements) và lối thoát [[any]] lây lan, codebase TS lớn rất dễ "xanh lúc compile, đỏ lúc chạy". JD OTS ghi rõ TypeScript, code có tài liệu, good practice: người phỏng vấn sẽ hỏi bạn cấu hình strict thế nào, mô hình hoá domain ra sao, validate ở đâu, xử lý lỗi kiểu gì.

### tsconfig cho backend production
| Option | Bắt lỗi gì | Ghi chú |
|---|---|---|
| strict | bật cụm strictNullChecks, noImplicitAny, strictPropertyInitialization, useUnknownInCatchVariables... | bắt buộc với code mới; thêm noImplicitOverride, noFallthroughCasesInSwitch |
| noUncheckedIndexedAccess | kết quả [[const v = arr[i];]] có kiểu T hoặc undefined | bắt loại bug "lookup map trả zero value" quen thuộc bên Go |
| exactOptionalPropertyTypes | [[{ eta?: Date }]] không cho gán [[eta: undefined]] tường minh | phân biệt "không gửi field" với "gửi để xoá" khi PATCH |
| isolatedModules | mỗi file transpile độc lập được | bắt buộc nếu build bằng swc/esbuild |
~~~json
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "outDir": "dist",
  "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true, "isolatedModules": true,
  "experimentalDecorators": true, "emitDecoratorMetadata": true, "sourceMap": true } }
~~~
Hai cờ decorator là bắt buộc với NestJS (DI đọc metadata kiểu tham số constructor).

### type vs interface, enum vs union literal
**interface** cho object shape và contract công khai (DTO, port/adapter, class implements), có declaration merging để mở rộng type thư viện (ví dụ Express Request), thông báo lỗi dễ đọc. **type alias** cho union, tuple, mapped/conditional type và kiểu suy ra. Trong một codebase, nhất quán quan trọng hơn chọn bên nào.
Enum của TS **sinh code runtime**: numeric enum có reverse mapping, const enum vỡ khi build từng file (isolatedModules), và cả type stripping của Node 22.6+ lẫn cờ erasableSyntaxOnly (TS 5.8) đều **không nhận enum**. Mặc định dùng union literal + object [[as const]]:
~~~ts
export const BookingStatus = { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' } as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus]; // 'DRAFT' | 'CONFIRMED' | 'CANCELLED'
~~~

### Discriminated union + exhaustive check bằng never
Discriminated union (union có trường phân biệt, ở đây là [[kind]]) mô hình hoá trạng thái mà Go thường làm bằng struct nhiều field rỗng. Kết hợp [[never]], compiler buộc xử lý mọi biến thể:
~~~ts
type ContainerEvent =
  | { kind: 'GATE_IN'; at: Date; terminal: string }
  | { kind: 'LOADED'; at: Date; vesselVoyage: string }
  | { kind: 'DISCHARGED'; at: Date; port: string };
const assertNever = (x: never): never => { throw new Error('Unhandled variant: ' + JSON.stringify(x)); };
export function describeEvent(e: ContainerEvent): string {
  switch (e.kind) {
    case 'GATE_IN': return 'Vào cảng ' + e.terminal;
    case 'LOADED': return 'Đã xếp lên ' + e.vesselVoyage; // e đã được thu hẹp
    case 'DISCHARGED': return 'Dỡ tại ' + e.port;
    default: return assertNever(e); // thêm GATE_OUT mà quên case là lỗi compile
  }
}
~~~

### Generics có ràng buộc, utility types, unknown
~~~ts
interface Entity { id: string; tenantId: string }
export interface Repo<T extends Entity> {
  findById(tenantId: string, id: string): Promise<T | null>;
  update(tenantId: string, id: string, patch: Partial<Omit<T, 'id' | 'tenantId'>>): Promise<T>;
}
declare function pick<T, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K>; // K chỉ nhận key có thật của T
~~~
| Utility | Dùng cho | Ví dụ backend |
|---|---|---|
| Partial, Required, Readonly | mọi field tuỳ chọn / bắt buộc / chỉ đọc | payload PATCH, config sau validate |
| Pick, Omit | lấy hoặc bỏ field | response bỏ passwordHash |
| [[Record<K, V>]] | map key cố định sang value | phụ phí theo loại container |
| ReturnType, Parameters, Awaited | lấy kiểu từ hàm có sẵn, bóc Promise | [[Awaited<ReturnType<typeof loadVoyage>>]] |
- [[any]] tắt type checker và **lây** sang mọi thứ chạm vào nó; [[unknown]] bắt buộc thu hẹp (narrowing) trước khi dùng. Dưới strict, biến trong [[catch (e)]] có kiểu unknown.
- **Type guard** [[function isAxiosError(e: unknown): e is AxiosError]] thu hẹp trong nhánh if; **assertion function** [[asserts v is NonNullable<T>]] ném lỗi nếu sai, sau lệnh gọi compiler coi như đã chắc.
- [[as]] là ép kiểu, compiler tin bạn vô điều kiện; [[satisfies]] (TS 4.9) kiểm tra khớp type mà vẫn giữ kiểu suy luận hẹp, hợp cho object config và bảng tra.

### Validate runtime ở biên: type không tồn tại lúc chạy
Mọi thứ đi vào từ ngoài (HTTP body/query/header, env, message RabbitMQ/BullMQ, response API đối tác, document MongoDB cũ) phải validate **một lần ở biên**, bên trong thì tin type. Zod cho schema là nguồn sự thật duy nhất, type suy ra từ schema; NestJS truyền thống dùng class-validator trên DTO class (xem J3).
~~~ts
import { z } from 'zod';
export const CreateBookingSchema = z.object({
  vesselVoyage: z.string().regex(/^[A-Z0-9]{4,10}$/),
  containerType: z.enum(['20GP', '40GP', '40HC', '45HC']),
  quantity: z.number().int().min(1).max(500),
});
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
const parsed = CreateBookingSchema.safeParse(body);
if (!parsed.success) throw new ValidationError(parsed.error.issues); // 400 kèm lỗi theo từng field
~~~
| Loại type | Sống ở đâu | Quy tắc |
|---|---|---|
| DTO (request/response) | biên HTTP/queue | có validate, có version, không lộ field nội bộ (passwordHash, tenantId) |
| Entity (ORM) | tầng persistence | ánh xạ bảng/collection, có decorator, có thể lazy relation |
| Domain type | logic nghiệp vụ | không phụ thuộc framework, giữ invariant (quantity lớn hơn 0) |
Map tường minh DTO sang domain sang entity; trả thẳng entity ra response vừa lộ dữ liệu vừa dễ kích hoạt lazy load N+1 khi serialize.

### Error handling: Result, throw và cause
TS không có checked exception, cũng không có [[if err != nil]] bắt buộc như Go. Quy ước gợi ý: lỗi **nghiệp vụ dự kiến** (hết chỗ trên chuyến, booking đã huỷ) trả về **Result** để caller buộc xử lý; lỗi **bất ngờ** (DB sập, bug) thì throw để exception filter đổi thành 500. Bọc lỗi bằng [[cause]] (ES2022), tương đương [[fmt.Errorf("...: %w", err)]] trong Go:
~~~ts
export class DomainError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
export type Result<T, E = DomainError> = { ok: true; value: T } | { ok: false; error: E };
try { await partnerApi.getSchedule(voyageId); }
catch (err) { throw new DomainError('PARTNER_TIMEOUT', 'Lịch tàu đối tác không phản hồi', { cause: err }); }
~~~

### Module, path alias, build, lint, TSDoc
| Chủ đề | Điều cần biết |
|---|---|
| CommonJS vs ESM | CJS: require, đồng bộ, __dirname. ESM: import, top-level await, import tương đối phải có đuôi .js khi dùng NodeNext. NestJS mặc định CJS; thư viện ESM-only (p-limit 4+, nanoid 4+) cần dynamic import hoặc require(esm) của Node 22.12+ |
| Path alias | [[paths]] trong tsconfig chỉ giúp compiler; **tsc không rewrite** đường dẫn khi emit nên chạy dist báo "Cannot find module". Cần tsc-alias, tsconfig-paths, bundler, hoặc subpath imports [[#app/*]] trong package.json |
| Build, lint | tsc vừa type-check vừa emit (chậm); swc/esbuild chỉ transpile, nhanh hơn hàng chục lần nhưng **không type-check**, nên CI phải chạy [[tsc --noEmit]] (Nest CLI có builder swc). typescript-eslint type-aware: no-floating-promises, no-misused-promises, switch-exhaustiveness-check; Prettier lo format |
**TSDoc** (chuẩn comment của TS: IDE hiện khi hover, TypeDoc sinh trang tài liệu, Swagger plugin của Nest đọc được với introspectComments): ghi **vì sao**, đơn vị, invariant, lỗi ném ra; không lặp lại điều type đã nói.
~~~ts
/**
 * Tính lại ETA khi tàu trễ ở cảng trung chuyển; phát sự kiện ETA_CHANGED nếu lệch quá ngưỡng.
 * @param voyageId - Mã chuyến (vessel + voyage), đã validate ở controller.
 * @param delayMinutes - Độ trễ tính bằng phút, không âm.
 * @returns ETA mới theo UTC.
 * @throws {@link VoyageNotFoundError} nếu chuyến không thuộc tenant hiện tại.
 */
export async function recalcEta(voyageId: string, delayMinutes: number): Promise<Date> { /* ... */ }
~~~

### Sai lầm hay gặp
- [[req.body as Dto]] hoặc [[JSON.parse(raw) as T]] rồi coi như đã an toàn.
- Dùng any "tạm thời" ở adapter rồi nó lan vào domain; đúng ra là unknown + validate.
- Build bằng swc/ts-node transpile-only mà CI không chạy tsc --noEmit: lỗi type đi thẳng lên production.
- Trả entity ORM ra API: lộ field, N+1, đổi schema DB là vỡ contract với FE/đối tác.
- Throw string hoặc object thường: mất stack trace; luôn throw Error subclass và giữ cause.
- Rải optional chaining khắp nơi để "chữa" strictNullChecks thay vì mô hình hoá đúng trạng thái bằng union.

### Nói thế nào trong phỏng vấn (EN)
- "Types are erased at runtime, so I validate every external input once at the boundary and infer the type from the schema." — Type bị xoá lúc chạy nên tôi validate input ở biên và suy type từ schema.
- "I model states as discriminated unions with a never check, so adding a variant breaks the build, not production." — Trạng thái là discriminated union + never: thêm biến thể thì vỡ build chứ không vỡ production.
- "Expected business failures return a Result; unexpected ones throw, wrapped with cause like error wrapping in Go." — Lỗi nghiệp vụ trả Result; lỗi bất ngờ throw, bọc cause giống wrap error trong Go.
- "We build with swc for speed, but CI runs tsc --noEmit and type-aware ESLint." — Build bằng swc cho nhanh, nhưng CI chạy tsc --noEmit và ESLint có type.
- "I prefer string literal unions over enums because they are erasable and serialize cleanly to JSON." — Tôi chọn union literal thay enum vì xoá được khi build và ra JSON gọn.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện chính**: reconcile policy "diff theo toàn policy" xoá mềm violation khi lần eval lỗi hoặc trả 0 kết quả (910k violation mồ côi). Gốc rễ: "eval lỗi" và "không có vi phạm" cùng một hình dạng (slice rỗng). Kể cách TS chặn từ thiết kế: kiểu EvalOutcome là discriminated union ok/failed, nhánh failed không có field violations nên không thể vô tình đem đi diff.
- Lambda mất [[REDIS_HOST]]/[[RABBITMQ_*]] rồi fallback localhost im lặng, FE bake NEXT_PUBLIC sai: kể "giờ tôi validate env bằng schema lúc khởi động, thiếu là không start" (zod hoặc ConfigModule, xem J3).
- Parse CycloneDX/SPDX: field license lúc là string lúc là object, Go phải viết UnmarshalJSON tay; TS dùng union + zod schema. Bằng chứng bạn hiểu "dữ liệu ngoài không đáng tin".
- Bẫy nil interface của Go đối chiếu strictNullChecks + noUncheckedIndexedAccess: cho thấy bạn hiểu cả hai hệ type.
- Nếu bị hỏi "TS ít năm hơn Go": nói thẳng 5 năm với type system tĩnh, khác biệt chính là erasure và structural typing, rồi chỉ vào dcn_toolbox chạy strict.
- Luyện 1: bật strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes cho một service dcn_toolbox, đếm lỗi, sửa hết, ghi lại 3 bug thật tìm ra (câu chuyện "code quality" rất tốt).
- Luyện 2: thêm typescript-eslint type-aware (no-floating-promises, switch-exhaustiveness-check) vào CI của dcn_toolbox, chạy [[tsc --noEmit]] song song với build.
- Luyện 3: viết module booking nhỏ: zod schema sang type, discriminated union cho ContainerEvent, Result cho "hết chỗ", TSDoc cho mọi hàm export và sinh trang bằng TypeDoc.
- Luyện 4: đổi một enum trong dcn_toolbox sang union literal + as const, chạy file bằng [[node --experimental-strip-types]] để thấy enum bị từ chối.
`,
  quiz: [
    { t: 'mc', q: 'Bật noUncheckedIndexedAccess, với [[rates: Record<string, number>]], biểu thức [[const v = rates[code];]] có kiểu gì?', o: ['number', 'number hoặc undefined', 'unknown', 'any'], a: 1, why: 'Truy cập theo index được coi là có thể không tồn tại, buộc bạn kiểm tra trước khi dùng.' },
    { t: 'mc', q: 'Controller dùng [[req.body as CreateBookingDto]] rồi lưu thẳng DB. Khách gửi quantity là chuỗi "abc". Chuyện gì xảy ra?', o: ['TypeScript ném lỗi lúc runtime vì sai kiểu', 'Compiler báo lỗi lúc build', 'Không có gì chặn: type đã bị xoá khi build, chuỗi đi thẳng xuống tầng dưới', 'Node tự ép chuỗi sang number'], a: 2, why: 'Type erasure: as chỉ là lời hứa với compiler; phải validate runtime ở biên.' },
    { t: 'mc', q: 'Team build NestJS bằng swc cho nhanh và CI chỉ chạy bước build. Rủi ro lớn nhất?', o: ['Lỗi type không bị phát hiện vì swc chỉ transpile, không type-check', 'Decorator của Nest không chạy được', 'Bundle to gấp đôi', 'Source map lệch dòng'], a: 0, why: 'swc/esbuild bỏ qua kiểm tra type; CI cần tsc --noEmit.' },
    { t: 'mc', q: "Dev khai báo paths cho alias @app/* trong tsconfig, chạy ts-node ổn, nhưng [[node dist/main.js]] báo Cannot find module '@app/booking'. Vì sao?", o: ['Thiếu đuôi .js trong import', 'Node không cho ký tự @ trong tên module', 'Chưa bật esModuleInterop', 'tsc không rewrite path alias khi emit; cần tsc-alias, tsconfig-paths, bundler hoặc subpath imports'], a: 3, why: 'paths chỉ ảnh hưởng resolve lúc compile, output vẫn giữ nguyên chuỗi import.' },
    { t: 'mc', q: 'Thêm biến thể GATE_OUT vào union ContainerEvent; hàm describeEvent có nhánh default gọi assertNever(e). Điều gì xảy ra?', o: ['Compile vẫn qua, runtime ném lỗi khi gặp GATE_OUT', 'Lỗi compile tại assertNever(e) vì e còn kiểu GATE_OUT, không phải never', 'Không có gì, default nuốt case mới', 'Chỉ ESLint cảnh báo, build vẫn qua'], a: 1, why: 'Exhaustive check: còn biến thể chưa xử lý thì e không thu hẹp về never.' },
    { t: 'fill', q: 'Kiểu an toàn thay cho any, buộc phải thu hẹp trước khi dùng, cũng là kiểu của biến trong catch khi bật strict: ___.', a: ['unknown'], why: 'unknown không cho gọi method hay truy cập field khi chưa narrowing.' },
    { t: 'fill', q: 'Toán tử ___ (TS 4.9) kiểm tra một giá trị khớp type mà vẫn giữ kiểu suy luận hẹp, khác với ép kiểu bằng as.', a: ['satisfies'], why: 'satisfies kiểm tra mà không widen; as thì tắt kiểm tra.' },
    { t: 'open', q: 'Thiết kế cách xử lý lỗi cho API tạo booking viết bằng TypeScript: khi nào throw, khi nào trả Result, và lỗi đi ra client trông thế nào?', a: 'Tôi chia hai loại. Lỗi nghiệp vụ dự kiến (hết chỗ trên chuyến, booking đã huỷ, qua cut-off) trả về Result, kiểu discriminated union ok true kèm value hoặc ok false kèm error, nên caller buộc phải xử lý nhánh lỗi. Lỗi bất ngờ (DB timeout, API đối tác sập, bug) thì throw một Error subclass, bọc lỗi gốc bằng cause để giữ stack giống %w trong Go. Ở biên, một exception filter map DomainError sang HTTP status và error contract thống nhất: error code ổn định (BOOKING_CAPACITY_EXCEEDED), message, traceId, chi tiết theo field; lỗi lạ trả 500 không lộ stack. Input được validate bằng schema trước khi vào service nên service không phải lo kiểu sai.', keys: ['Result', 'cause', 'discriminated union', 'exception filter', 'error code'] }
  ]
},
{ id: 'J3', type: 'job', topic: 'node', title: 'NestJS ở mức production', time: '150 phút',
  goal: 'Vẽ lại được vòng đời request của NestJS, chọn đúng DI scope, đặt auth/tenant/validation/timeout/lỗi vào đúng tầng, xử lý cron nhiều instance, queue, health check, viết được unit + e2e test với Test.createTestingModule, và kể dcn_toolbox như một dự án Nest thật.',
  md: `
### Vấn đề cần giải
Express trơn chỉ cho router + middleware; mỗi team tự chế cách tổ chức code, inject dependency, validate, xử lý lỗi, nên 10 service là 10 kiểu. NestJS là framework có chủ kiến (opinionated, cảm hứng từ Angular/Spring): **module** đóng gói feature, **DI container** quản lý vòng đời object, **pipeline request** chuẩn (guard, interceptor, pipe, filter), adapter cho HTTP (Express/Fastify), WebSocket, microservice, cron. Đổi lại: decorator + reflection khá "ma thuật", khởi động chậm hơn, dễ lạm dụng request scope. Phỏng vấn sẽ hỏi: request đi qua tầng nào theo thứ tự nào, scope nào tốn kém, auth/tenant đặt ở đâu, cron chạy nhiều instance thì sao, test thế nào.

### Module, provider, controller
| Khối | Vai trò | Ví dụ booking |
|---|---|---|
| Module ([[@Module]]) | đóng gói feature: imports, providers, controllers, exports | BookingModule export BookingService cho InvoiceModule |
| Provider ([[@Injectable]]) | service, repository, client, factory; inject qua constructor | BookingService, ScheduleClient |
| Controller | map route sang method, chỉ lo HTTP (parse, status code) | [[POST /bookings]], [[GET /bookings/:id]] |
| Dynamic module | cấu hình lúc import: [[forRoot]], [[forRootAsync]], [[register]] | TypeOrmModule.forRootAsync đọc ConfigService |
Thư mục **theo feature**, không theo loại file: [[src/booking/]] chứa module, controller, service, repository, [[dto/]], [[entities/]]; [[src/tracking/]] chứa gateway socket.io và consumer RabbitMQ; [[src/common/]] cho guard/interceptor/filter dùng chung; [[src/config/]] cho schema env. Xoá hay tách một feature thành service riêng chỉ đụng một thư mục.

### DI container và scope
| Scope | Số instance | Dùng khi | Cái giá |
|---|---|---|---|
| DEFAULT (singleton) | 1 cho cả app, tạo lúc bootstrap | gần như mọi service stateless | không được giữ state theo request trong field |
| REQUEST | 1 mỗi request | provider cần object REQUEST | **lan lên cả chuỗi**: ai inject nó cũng thành request-scoped, kể cả controller; cả cây object tạo lại mỗi request, throughput giảm rõ; khó dùng trong cron/consumer |
| TRANSIENT | 1 cho mỗi chỗ inject | logger mang context riêng từng class | nhiều instance, không chia sẻ cache |
Cần tenantId/traceId theo request mà vẫn singleton: dùng **AsyncLocalStorage** (gói nestjs-cls), giống context.Value của Go. Circular dependency phải dùng [[forwardRef]] thường là dấu hiệu chia module sai.

### Vòng đời một request
:::diagram
Req[HTTP request] -> MW[Middleware] : request-id, helmet
MW -> Guard[Guard] : JWT, RBAC, tenant
Guard -> IntIn[Interceptor trước] : log, timeout
IntIn -> Pipe[Pipe] : validate, transform
Pipe -> Handler[Controller + Service]
Handler -> IntOut[Interceptor sau] : map response
IntOut -> Res[HTTP response]
Pipe -> Filter[Exception filter] : 400 validate
Handler -> Filter : lỗi nghiệp vụ, lỗi lạ
Filter -> Res : error contract JSON
:::
Guard, interceptor, pipe chạy theo thứ tự global → controller → route; interceptor chiều ra chạy ngược lại (kiểu củ hành); lỗi ở bất kỳ tầng nào (kể cả 401/403 từ guard) đều rơi vào exception filter, filter gần nhất (route) bắt trước. Middleware chỉ thấy req/res, không biết handler nào sẽ chạy; guard có ExecutionContext nên đọc được metadata [[@Roles()]], vì vậy auth/RBAC đặt ở guard.

### Config: fail fast khi thiếu env
~~~ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().min(1), // không có default 'localhost'
  RABBITMQ_URL: z.string().startsWith('amqp'),
});
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: (raw) => EnvSchema.parse(raw) })] })
export class AppModule {}
~~~
Thiếu hoặc sai biến là app **không khởi động**: deploy fail và alert ngay, tốt hơn nhiều so với fallback localhost rồi im lặng hỏng hàng giờ. Biến [[NEXT_PUBLIC_*]] của FE bị bake lúc build nên phải validate ở bước build trong CI.

### Pipe, Guard, Interceptor trong thực tế
~~~ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
export class CreateBookingDto {
  @IsIn(['20GP', '40GP', '40HC', '45HC']) containerType!: string;
  @IsInt() @Min(1) @Max(500) quantity!: number;
}
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const need = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user; // JwtAuthGuard đã gắn trước
    return !need?.length || need.some((r) => user.roles.includes(r));
  }
}
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(timeout(5_000), catchError((e) =>
      throwError(() => (e instanceof TimeoutError ? new RequestTimeoutException() : e))));
  }
}
~~~
- **whitelist** bỏ field lạ: chặn mass assignment (client tự gửi [[tenantId]] hay [[role]] trong body).
- **Tenant** lấy từ token đã verify, không bao giờ từ body/header tự khai; guard đặt tenantId vào CLS, repository tự thêm điều kiện tenant vào mọi query.
- Timeout bằng rxjs chỉ **trả lỗi cho client**, query DB phía sau vẫn chạy: cần statement_timeout ở DB hoặc hủy ở driver.

### Exception filter và error contract
| Tình huống | HTTP | code trong body |
|---|---|---|
| DTO sai (ValidationPipe) | 400 | VALIDATION_FAILED + lỗi từng field |
| Thiếu/hết hạn token; sai role hoặc khác tenant | 401; 403 (hoặc 404 để không lộ tồn tại) | AUTH_REQUIRED; FORBIDDEN |
| Hết chỗ trên chuyến (DomainError) | 409 | BOOKING_CAPACITY_EXCEEDED |
| Đối tác timeout | 504 | UPSTREAM_TIMEOUT |
| Lỗi lạ | 500, không lộ stack | INTERNAL_ERROR + traceId |
Một filter toàn cục ([[@Catch()]]) map lỗi theo bảng trên, log kèm traceId, trả body thống nhất [[{ code, message, traceId, details }]] để FE và đối tác API xử lý theo code chứ không theo câu chữ.

### ORM trong Nest: transaction và N+1
| ORM | Transaction | Bẫy N+1 và RAM |
|---|---|---|
| TypeORM | [[dataSource.transaction(async (m) => ...)]]; mọi repo trong tx phải lấy từ manager m | eager/lazy relation; load quan hệ lớn vào RAM |
| Prisma | [[prisma.$transaction(async (tx) => ...)]]; interactive tx mặc định timeout 5 s | findUnique trong vòng lặp; dùng include hoặc gom IN |
| Mongoose | [[session.withTransaction()]]; cần replica set | populate là thêm query; đọc nên dùng lean() |
Truyền transaction qua nhiều service mà không kéo manager qua mọi tham số: @nestjs-cls/transactional. Publish message **sau commit** (hoặc outbox), không publish bên trong tx.

### Cron, queue, health check
- [[@Cron('*/15 * * * *')]] của @nestjs/schedule chạy **trong mọi instance**: 3 replica là 3 lần chạy; lịch nằm trong RAM nên redeploy đúng lúc là lỡ tick (y hệt gocron + Watchtower). Sửa: tách cron ra deployment 1 replica, hoặc khoá phân tán (Redis SET NX PX, pg_try_advisory_lock) + lưu lần chạy cuối để chạy bù + job idempotent; hoặc BullMQ repeatable job (lịch nằm trong Redis, mỗi tick một worker nhận); hoặc Cloud Scheduler gọi endpoint.
- BullMQ (@nestjs/bullmq): processor extends WorkerHost, attempts + backoff exponential, concurrency, removeOnComplete. RabbitMQ qua @nestjs/microservices [[Transport.RMQ]]: [[@EventPattern]] (event, không chờ trả lời) vs [[@MessagePattern]] (request-response); noAck false + ack sau khi xử lý xong, prefetchCount giới hạn message đang xử lý; theo dõi sự kiện disconnect để publisher không chết im lặng.
- @nestjs/terminus: [[/health/live]] chỉ báo process còn sống, **không** check DB (DB chậm mà liveness fail thì cả fleet bị restart); [[/health/ready]] check DB, Redis, RabbitMQ, heap.

### Testing
~~~ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ScheduleClient).useValue({ getVoyage: jest.fn().mockResolvedValue(voyageFixture) })
  .compile();
const app = moduleRef.createNestApplication(); await app.init();
await request(app.getHttpServer()).post('/bookings').set('Authorization', 'Bearer ' + token)
  .send({ vesselVoyage: 'ABC123', containerType: '40HC', quantity: 0 }).expect(400);
~~~
Unit test: createTestingModule chỉ với service + mock repository. Integration/e2e: app thật + Postgres thật bằng Testcontainers, supertest gọi HTTP. Bẫy: pipe/filter đăng ký trong main.ts thì e2e không có; đăng ký qua provider [[APP_PIPE]], [[APP_FILTER]], [[APP_GUARD]] trong module để test giống production.

### Bạn đã có: dcn_toolbox
Nhiều service NestJS (ssh-monitor, host-doctor, deploy-inspector, release, cmd, auth), mỗi service một **schema Postgres riêng**, đăng nhập mật khẩu + **TOTP** dùng chung cho mọi tool, socket.io cho terminal/log realtime, registry tool + lệnh scaffold service mới, audit log gộp ở trang admin. Đây là bằng chứng bạn dùng Nest ngoài tutorial; cách kể ở mục Áp dụng.

### Sai lầm hay gặp
- Dùng REQUEST scope để lấy tenantId rồi không hiểu vì sao throughput tụt; dùng CLS.
- Kiểm tra auth trong middleware: không biết handler, không đọc được [[@Roles()]]; đặt ở guard.
- Logic nghiệp vụ trong controller, hoặc service phụ thuộc trực tiếp vào Request/Response của Express.
- [[@Cron]] trong app scale ngang mà không có lock: job chạy N lần, email gửi N lần.
- Liveness check DB; filter nuốt lỗi trả 200 hoặc lộ stack trace ra client.

### Nói thế nào trong phỏng vấn (EN)
- "A request flows through middleware, guards, interceptors, pipes and the handler, then back through interceptors; any exception lands in exception filters." — Request đi qua middleware, guard, interceptor, pipe, handler rồi quay lại interceptor; lỗi rơi vào filter.
- "I keep providers singleton and carry tenant and trace IDs in AsyncLocalStorage, because request scope rebuilds the whole dependency chain per request." — Giữ singleton, tenant/trace để trong AsyncLocalStorage vì request scope dựng lại cả chuỗi mỗi request.
- "Config is validated at startup, so a missing variable fails the deploy instead of silently falling back to localhost." — Config validate lúc khởi động để thiếu biến là deploy fail, không âm thầm về localhost.
- "In a horizontally scaled app, scheduled jobs need a lock or a dedicated runner, otherwise every replica fires." — App scale ngang thì cron cần lock hoặc runner riêng, không thì replica nào cũng chạy.
- "For e2e tests I register global pipes and filters as APP_PIPE and APP_FILTER providers and override only external clients." — E2e: đăng ký pipe/filter qua APP_PIPE/APP_FILTER, chỉ override client bên ngoài.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện dcn_toolbox (2 phút, STAR)**: vấn đề là vận hành canary/pilot bằng nhiều thao tác tay rời rạc (SSH, docker logs, kiểm tra deploy); quyết định là mỗi tool một service NestJS, schema Postgres riêng để migration độc lập, service auth riêng (mật khẩu + TOTP) cho mọi tool, socket.io stream terminal/log; kết quả là thêm tool mới bằng lệnh scaffold, audit log tập trung. Chuẩn bị số thật: số service, số endpoint, thời gian thêm một tool.
- Soạn sẵn câu trả lời cho câu vặn: "Vì sao schema riêng mà không DB riêng?", "TOTP secret lưu thế nào, chống dùng lại mã ra sao?", "socket.io chạy 2 instance thì sao?" (Redis adapter + sticky session).
- gocron + Watchtower lỡ tick: nói thẳng @nestjs/schedule có cùng bệnh, và cách bạn sẽ sửa (BullMQ repeatable hoặc lock + chạy bù + idempotent).
- Audit log publish trước commit gây FK violation ở consumer: bản Nest là publish sau khi transaction xong hoặc outbox.
- Lambda thiếu [[REDIS_HOST]]/[[RABBITMQ_*]]: bản Nest là ConfigModule validate, thiếu biến thì không start.
- statement_timeout 90 s ở cấp role: liên hệ "TimeoutInterceptor không giết được query", phải đặt timeout ở DB/driver.
- Luyện 1: thêm ConfigModule + zod validate cho mọi service dcn_toolbox; xoá thử một biến, xác nhận service không start và log rõ biến nào thiếu.
- Luyện 2: viết e2e cho service auth bằng Test.createTestingModule + supertest + Testcontainers Postgres: sai mật khẩu, TOTP sai, TOTP đúng; pipe/filter đăng ký qua APP_PIPE/APP_FILTER.
- Luyện 3: chuyển một cron của dcn_toolbox sang BullMQ repeatable job, chạy 2 instance, chứng minh mỗi tick chỉ chạy một lần.
- Luyện 4: thêm @nestjs/terminus với /health/live và /health/ready cho ssh-monitor, nối vào healthcheck của docker compose.
`,
  quiz: [
    { t: 'mc', q: 'Thứ tự các tầng mà một HTTP request đi qua trong NestJS là gì?', o: ['Middleware → Pipe → Guard → Interceptor → handler', 'Guard → Middleware → Interceptor → Pipe → handler', 'Middleware → Guard → Interceptor → Pipe → handler → Interceptor (chiều ra)', 'Middleware → Interceptor → Guard → Pipe → handler'], a: 2, why: 'Guard quyết định có cho vào không trước khi interceptor và pipe chạy; interceptor bọc cả hai chiều.' },
    { t: 'mc', q: 'BookingService chuyển sang Scope.REQUEST để đọc tenantId từ request. Sau deploy throughput giảm rõ. Vì sao?', o: ['Request scope bật lại validation cho mọi field', 'Mọi provider và controller phụ thuộc BookingService cũng thành request-scoped, cả cây object bị tạo lại mỗi request', 'Request scope tắt connection pooling của TypeORM', 'Nest chuyển sang xử lý request tuần tự'], a: 1, why: 'Scope lan lên chuỗi phụ thuộc; dùng AsyncLocalStorage (nestjs-cls) để giữ singleton.' },
    { t: 'mc', q: 'Service chạy 3 replica, có @Cron mỗi 15 phút gửi email báo ETA thay đổi. Khách phàn nàn nhận 3 email giống nhau. Cách sửa phù hợp nhất?', o: ['Đổi cron thành mỗi 45 phút', 'Thêm try/catch quanh hàm cron', 'Tăng prefetchCount của RabbitMQ', 'Khoá phân tán hoặc BullMQ repeatable job để mỗi tick chỉ một instance chạy, kèm idempotency key cho email'], a: 3, why: 'Lịch in-memory chạy ở mọi replica; cần một nơi điều phối và thao tác idempotent.' },
    { t: 'mc', q: 'Nên đặt kiểm tra JWT + role ở tầng nào?', o: ['Guard, vì có ExecutionContext đọc được metadata @Roles của handler', 'Middleware, vì chạy sớm nhất', 'Pipe, vì đã có DTO', 'Exception filter'], a: 0, why: 'Middleware không biết handler nào sẽ chạy; guard được thiết kế để trả lời "có cho vào không".' },
    { t: 'mc', q: 'TimeoutInterceptor 5 s trả 408 cho client, nhưng DB vẫn ghi nhận query báo cáo chạy 80 s. Vì sao?', o: ['Interceptor chưa được đăng ký global', 'Postgres bỏ qua mọi timeout phía client', 'rxjs timeout chỉ hủy Observable phía Nest; query đã gửi xuống DB vẫn chạy nếu không có statement_timeout hoặc hủy ở driver', 'ValidationPipe chạy sau interceptor nên chặn timeout'], a: 2, why: 'Hủy ở tầng HTTP không lan xuống DB; giống bài học statement_timeout ở hệ SBOM.' },
    { t: 'fill', q: 'Để ValidationPipe tự loại bỏ field không khai báo trong DTO (chống mass assignment), bật tuỳ chọn ___: true.', a: ['whitelist'], why: 'Kết hợp forbidNonWhitelisted để trả 400 thay vì im lặng bỏ field.' },
    { t: 'fill', q: 'Hàm Test.___ của @nestjs/testing tạo module test, cho phép overrideProvider trước khi compile.', a: ['createtestingmodule'], why: 'Dùng cho cả unit (vài provider + mock) lẫn e2e (import AppModule rồi createNestApplication).' },
    { t: 'open', q: 'Bạn thiết kế multi-tenant cho customer portal viết bằng NestJS (mỗi công ty khách là một tenant). Tenant được xác định và cô lập thế nào qua các tầng?', a: 'Tenant lấy từ token đã verify (claim tenantId trong JWT), không bao giờ từ body hay header tự khai; ValidationPipe whitelist loại field tenantId client gửi lên. Một guard sau JwtAuthGuard kiểm tra user thuộc tenant và có role phù hợp, rồi đặt tenantId vào AsyncLocalStorage (nestjs-cls) để provider vẫn là singleton thay vì request scope. Tầng repository tự thêm điều kiện tenant_id vào mọi query (có thể thêm Row Level Security của Postgres làm lớp phòng thủ thứ hai); cache key và tên queue cũng có tiền tố tenant. Cron và consumer không có request nên phải tự set tenant vào CLS cho từng job. Cuối cùng có test e2e chứng minh tenant A gọi id của tenant B nhận 404, vì leak cross-tenant (như vụ first-writer-wins ở hệ SBOM) là lỗi đắt nhất.', keys: ['token', 'guard', 'AsyncLocalStorage', 'repository', 'test'] }
  ]
},
];
