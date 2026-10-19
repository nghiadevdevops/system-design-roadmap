/* ===== Giai đoạn 4 · Kiến thức phỏng vấn & thực chiến (tuần 21–24) — 12 bài Q&A chuyên sâu K1–K12 ===== */
window.LESSONS_K = [
{ id: 'K1', type: 'knowledge', topic: 'go', title: 'Go cho phỏng vấn backend', time: '120 phút',
  goal: 'Trả lời trôi chảy 15 câu hỏi Go hay gặp nhất (goroutine, channel, context, sync, memory model, slice/map/interface bẫy, GC, pprof) kèm câu vặn tiếp theo, và chỉ ra được 3 lỗi Go đã gây sự cố thật trong worker SBOM.',
  md: `
### Vấn đề cần giải
Vòng phỏng vấn backend Go không hỏi "cú pháp", mà hỏi **bạn hiểu runtime đến đâu để không tự bắn vào chân khi chạy production**: goroutine leak, data race, nil panic làm sập cả worker, GC ăn CPU, OOM. Hệ SBOM của bạn đã dính đủ: worker crash loop vì nil pointer trong parser policy, worker OOM 5 GiB vì Preload 490k dòng x 10 goroutine (sự cố #3). Bài này gom các câu hỏi theo dạng **hỏi → trả lời mẫu súc tích → câu vặn tiếp theo**.

### Phần 1 · Runtime & scheduler

#### Q1. Goroutine khác OS thread ở điểm nào?
**Trả lời mẫu:** Goroutine là green thread do Go runtime quản lý, stack khởi điểm ~2 KB và tự grow/shrink, còn OS thread stack cố định ~1–8 MB và do kernel schedule. Chuyển ngữ cảnh giữa goroutine chỉ đổi vài thanh ghi trong user space (~100–200 ns) so với thread ~1–2 µs qua kernel. Nhờ đó chạy 100k goroutine là bình thường, 100k thread thì không.
**Câu vặn:** "Vậy goroutine có free không?" → Không: mỗi goroutine ít nhất 2 KB + object nó giữ; goroutine leak (chờ channel không ai gửi) là nguồn rò bộ nhớ số 1 trong service Go lâu ngày. Phát hiện bằng pprof goroutine profile.

#### Q2. GMP scheduler hoạt động thế nào?
**Trả lời mẫu:** G = goroutine, M = OS thread, P = processor logic (số lượng = GOMAXPROCS, mặc định = số CPU). Mỗi P có local run queue (256 G) + 1 global queue; M phải cầm P mới chạy được G. Khi G block syscall, M tách khỏi P để M khác cầm P chạy tiếp (hand-off). P rỗi sẽ **work stealing** một nửa queue của P khác. Netpoller (epoll/kqueue) biến I/O mạng thành non-blocking nên 1 M phục vụ hàng nghìn kết nối. Từ Go 1.14 có async preemption: goroutine chạy quá ~10 ms bị sysmon cướp CPU, hết cảnh vòng lặp tính toán chặn GC.
**Câu vặn:** "Trong container giới hạn 2 CPU nhưng host 64 core, GOMAXPROCS bằng bao nhiêu?" → Go < 1.25 lấy 64 theo host → 64 P tranh 2 CPU, GC và scheduler tốn CPU vô ích; set GOMAXPROCS theo cgroup quota (thư viện automaxprocs) hoặc Go 1.25+ tự đọc cgroup.

#### Q3. Channel buffered vs unbuffered, các bẫy?
| Thao tác | Channel nil | Channel mở | Channel đã close |
|---|---|---|---|
| send | block mãi | block nếu đầy (unbuffered: đến khi có người nhận) | **panic** |
| receive | block mãi | block nếu rỗng | trả zero value ngay, ok = false |
| close | panic | OK | **panic** (close 2 lần) |
**Trả lời mẫu:** Unbuffered là điểm **đồng bộ**: send chỉ hoàn thành khi receive xảy ra, tạo quan hệ happens-before. Buffered tách producer/consumer, dùng làm bounded queue (backpressure). Quy tắc: chỉ **sender close**, receiver dùng [[for v := range ch]] hoặc [[v, ok := <-ch]]. Channel nil block mãi là tính năng: gán [[ch = nil]] để tắt một case trong select.
**Câu vặn:** "Buffer bao nhiêu là đủ?" → Buffer không tăng throughput ổn định, chỉ hấp thụ burst; nếu consumer chậm hơn producer thì buffer nào cũng đầy. Đo bằng len(ch)/cap(ch) rồi quyết định tăng consumer hay giảm producer.

#### Q4. select với default và timeout dùng ra sao?
~~~go
select {
case job := <-jobs:
    handle(job)
case <-ctx.Done():
    return ctx.Err()
case <-time.After(5 * time.Second): // lưu ý: trước Go 1.23 timer sống đến khi nổ → rò nếu lặp nhiều
    return ErrTimeout
}
~~~
**Trả lời mẫu:** select chọn **ngẫu nhiên** một case sẵn sàng (tránh starvation); có [[default]] thì thành non-blocking (try-send/try-receive). Timeout thì ưu tiên [[context.WithTimeout]] hơn time.After vì nó lan xuống mọi tầng gọi (DB, HTTP) thay vì chỉ chờ ở một chỗ.

#### Q5. context lan truyền hủy/deadline thế nào? Quy tắc dùng?
**Trả lời mẫu:** context là cây: cancel cha → Done() của mọi con đóng, [[ctx.Err()]] trả Canceled hoặc DeadlineExceeded. Quy tắc: ctx là **tham số đầu tiên**, không cất trong struct, luôn [[defer cancel()]], chỉ dùng Value cho dữ liệu request-scope (trace id, tenant id), không truyền dependency. Deadline cha chặt hơn con thì con bị cắt theo cha.
**Câu vặn:** "Request bị client cancel giữa chừng khi đang ghi DB thì sao?" → Nếu truyền ctx của request xuống tx thì tx bị rollback giữa chừng; với thao tác phải hoàn tất (ghi audit, commit outbox) dùng [[context.WithoutCancel]] (Go 1.21) kèm timeout riêng.

### Phần 2 · Đồng bộ & memory model

#### Q6. Mutex, RWMutex, WaitGroup, Once, errgroup: khi nào dùng gì?
| Công cụ | Dùng khi | Bẫy |
|---|---|---|
| sync.Mutex | critical section ngắn, ghi nhiều | không reentrant: lock 2 lần cùng goroutine = deadlock |
| sync.RWMutex | đọc nhiều ghi ít (cache config) | writer chờ sẽ chặn reader mới; nếu ghi thường xuyên thì chậm hơn Mutex |
| sync.WaitGroup | chờ N goroutine xong | [[Add]] phải gọi **trước** [[go]], không gọi trong goroutine |
| sync.Once | init lười, singleton | panic trong Once → coi như đã chạy, không retry |
| errgroup.WithContext | fan-out, hủy tất cả khi 1 lỗi; [[SetLimit(n)]] giới hạn song song | quên dùng ctx của group trong goroutine → không hủy được |
| atomic | counter, flag | chỉ cho 1 biến; không thay được invariant nhiều biến |
**Câu vặn:** "Vì sao không khuyên dùng sync.Map mặc định?" → sync.Map tối ưu cho key ghi 1 lần đọc nhiều hoặc goroutine đụng key rời nhau; map + RWMutex (hoặc sharded map) đơn giản và nhanh hơn cho đa số case.

#### Q7. Go memory model và happens-before là gì? Race detector hoạt động ra sao?
**Trả lời mẫu:** Không có đồng bộ thì goroutine A ghi biến, goroutine B có thể **không bao giờ** thấy giá trị mới (compiler/CPU reorder). Memory model định nghĩa các cạnh happens-before: channel send xảy ra trước receive hoàn thành; Unlock trước Lock kế tiếp; WaitGroup Done trước Wait trả về; atomic là sequentially consistent. Data race trong Go là **undefined behaviour**: map có thể fatal "concurrent map writes" (không recover được), slice header rách. Race detector ([[go test -race]], [[go build -race]]) dùng ThreadSanitizer, chậm 5–10 lần, tốn 5–10 lần RAM, và **chỉ bắt race thực sự xảy ra khi chạy** → phải chạy trên test có concurrency thật và bật ở staging.

#### Q8. Slice: len/cap và bug aliasing?
~~~go
a := make([]int, 3, 10)
b := append(a, 4)   // cap còn chỗ → b dùng chung mảng với a
b[0] = 99           // a[0] cũng thành 99!
c := append(a[:3:3], 4) // full slice expr ép cap = len → buộc cấp mảng mới
~~~
**Trả lời mẫu:** Slice là header {ptr, len, cap} 24 byte, truyền theo giá trị nhưng trỏ cùng mảng. append chỉ cấp mảng mới khi vượt cap (gấp ~2 khi nhỏ, ~1,25 khi lớn). Bug kinh điển: hàm nhận slice rồi append → ghi đè dữ liệu caller. Giữ slice con của mảng 100 MB cũng giữ cả 100 MB không GC được.
**Câu vặn:** "Xoá phần tử giữa slice O(1) thế nào?" → swap với phần tử cuối rồi cắt len, nếu không cần giữ thứ tự.

#### Q9. Interface và bẫy nil interface?
**Trả lời mẫu:** Interface là cặp (type, value). Biến interface chỉ == nil khi **cả hai** rỗng. Hàm trả [[*MyErr]] nil gán vào [[error]] → interface có type [[*MyErr]], value nil → [[err != nil]] là true. Quy tắc: hàm trả kiểu [[error]], return [[nil]] tường minh. Interface nhỏ (1–3 method) định nghĩa **ở phía dùng**, không ở phía implement; mock dễ nhờ đó.

### Phần 3 · Lỗi, panic, GC, vận hành

#### Q10. defer/panic/recover: worker phải recover thế nào?
~~~go
func (w *Worker) safeHandle(ctx context.Context, msg Msg) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v\\n%s", r, debug.Stack())
            metrics.Inc("worker_panic_total")
        }
    }()
    return w.handle(ctx, msg)
}
~~~
**Trả lời mẫu:** recover chỉ có tác dụng trong hàm defer **cùng goroutine** với panic; panic trong goroutine con không được recover thì **cả process chết**, bất kể goroutine cha có recover. Worker nhận message phải bọc mỗi handler bằng recover, ghi log kèm message id, nack/đưa vào DLQ, rồi tiếp tục. Hệ SBOM của bạn từng crash loop worker 30 phút một lần vì một policy có [[right.type == ""]] làm parser trả nil,nil → nil dereference; không recover nên mọi tenant khác cũng ngừng được phục vụ.
**Câu vặn:** "Có nên recover mọi panic rồi lờ đi?" → Không: recover để **cô lập** lỗi theo message, vẫn phải alert và sửa gốc; panic do bug lập trình (index, nil) lặp lại cùng message thì phải đưa vào DLQ sau N lần, nếu không thành poison message.

#### Q11. GC của Go và GOGC/GOMEMLIMIT?
**Trả lời mẫu:** GC concurrent mark-sweep tri-color, non-generational, non-compacting, STW rất ngắn (thường < 1 ms). GOGC=100 mặc định: GC chạy khi heap đạt 2 x live heap → RSS ~2 x dữ liệu sống + stack + overhead. GOMEMLIMIT (Go 1.19) là soft limit: gần ngưỡng GC chạy dày hơn, nhưng runtime chặn GC chiếm quá ~50% CPU để tránh death spiral. Khuyến nghị: container limit X thì GOMEMLIMIT ≈ 0,8–0,9 X và giữ GOGC mặc định hoặc off.
**Câu vặn:** "GOMEMLIMIT có cứu được worker 5 GiB không?" → Không, vì live heap thật sự là 490k struct x 10 goroutine; limit chỉ làm GC quay cuồng rồi vẫn OOM. Thuốc đúng: stream/batch query (LIMIT theo id), semaphore giới hạn số project xử lý song song, và container phải có memory limit để chết sớm, có log, thay vì kéo cả host OOM.

#### Q12. Error wrapping chuẩn?
**Trả lời mẫu:** [[fmt.Errorf("fetch %s: %w", url, err)]] để bọc; [[errors.Is]] so sentinel, [[errors.As]] lấy kiểu cụ thể, [[errors.Join]] gộp nhiều lỗi (Go 1.20). Mỗi tầng thêm ngữ cảnh một lần, không log rồi lại return (log kép). Không so chuỗi lỗi. Lỗi là một phần API: export sentinel ([[ErrNotFound]]) hoặc kiểu lỗi có method.

#### Q13. Worker pool và graceful shutdown?
~~~go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
defer stop()
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(runtime.GOMAXPROCS(0) * 2)
for msg := range consumer.Deliveries() { // dừng nhận khi consumer.Cancel()
    msg := msg
    g.Go(func() error { return safeHandle(gctx, msg) })
}
_ = g.Wait() // chờ in-flight xong rồi mới đóng DB/AMQP
~~~
**Trả lời mẫu:** Thứ tự tắt: nhận SIGTERM → ngừng nhận việc mới (http.Server.Shutdown, AMQP channel.Cancel) → chờ in-flight với deadline (docker stop mặc định chờ 10 s rồi SIGKILL; Watchtower cũng vậy) → đóng kết nối. Việc dở phải idempotent vì có thể bị kill giữa chừng.

#### Q14. Dùng pprof thế nào khi service "ăn RAM"?
**Trả lời mẫu:** Expose [[net/http/pprof]] trên port nội bộ; [[go tool pprof -http=:8080 host/debug/pprof/heap]]: xem **inuse_space** (đang giữ) khác **alloc_space** (tổng cấp phát, chỉ ra điểm tạo rác); goroutine profile tìm leak (hàng nghìn goroutine kẹt cùng một dòng); CPU profile 30 s khi tải; block/mutex profile phải bật rate. So sánh 2 snapshot bằng [[-base]] để thấy phần tăng.

### Sai lầm hay gặp
- Nói "goroutine là thread nhẹ" rồi dừng, không nói được GMP, netpoller, preemption → bị đánh giá biết bề mặt.
- Dùng time.After trong vòng lặp nóng (Go < 1.23) → rò timer; dùng context hoặc Timer + Stop.
- Trả về [[*CustomErr]] nil dưới kiểu interface error → bug nil interface kinh điển.
- WaitGroup.Add trong goroutine; close channel từ phía receiver; recover ở goroutine cha mong bắt panic của con.
- Chạy test không -race rồi tuyên bố "không có race".
- Đổ lỗi OOM cho GC; không đo bằng pprof heap trước khi chỉnh GOGC.

### Nói thế nào trong phỏng vấn (EN)
- "Goroutines are multiplexed onto OS threads by the GMP scheduler, so blocking I/O doesn't pin a thread." — Goroutine được ghép lên thread bởi GMP, I/O chặn không giữ thread.
- "An unbuffered channel is a synchronization point; a buffered one is a bounded queue that gives you backpressure." — Unbuffered là điểm đồng bộ, buffered là hàng đợi có giới hạn tạo backpressure.
- "I always pass context as the first argument so cancellation and deadlines propagate down to the DB and HTTP layers." — Luôn truyền context đầu tiên để hủy/deadline lan xuống DB và HTTP.
- "A panic in a goroutine that isn't recovered kills the whole process, so every worker handler is wrapped with recover and the message goes to a DLQ." — Panic không recover giết cả process nên mỗi handler worker đều bọc recover và đẩy DLQ.
- "I'd set GOMEMLIMIT to roughly 85% of the container limit, but the real fix for a 5 GiB heap is streaming the query and bounding concurrency." — Đặt GOMEMLIMIT ~85% limit container, nhưng thuốc thật là stream query và giới hạn song song.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Worker crash loop vì nil panic trong parser policy: kiểm tra mọi điểm consume (RabbitMQ handler, gocron job, goroutine reconcile) đều có [[recover]] + metric [[worker_panic_total]] + nack vào DLQ sau 3 lần; viết test đưa policy có type rỗng vào parser và khẳng định không panic.
- Sự cố #3 (OOM 5 GiB): grep các chỗ [[Preload("Vulnerabilities")]] trên project lớn; đổi sang query theo batch id (keyset 5k dòng) hoặc chỉ lấy cột cần; bọc fan-out policy eval bằng [[errgroup.SetLimit(3)]] thay vì 10 goroutine không chặn.
- Thêm vào docker-compose: [[mem_limit]] cho worker + env [[GOMEMLIMIT]] = 85% limit, [[GOMAXPROCS]] theo quota CPU (automaxprocs). Khi đó OOM sẽ là OOMKilled=true trong [[docker inspect]], có thể alert.
- Bật [[net/http/pprof]] trên port nội bộ của worker (không expose ra ngoài); chụp heap profile lúc chạy reconcile của project 90k component, so sánh inuse_space trước/sau khi sửa Preload và ghi số vào ticket.
- Chạy [[go test -race ./...]] trong CI cho package worker/queue; sự cố publisher singleton (#1) có phần "reconnect đồng thời từ nhiều goroutine" chính là chỗ cần race detector.
- Graceful shutdown: hiện Watchtower recreate container sau 10 s SIGTERM; đo thời gian xử lý một message dài nhất (policy eval ~ phút?) để thấy việc đang dở bị kill → cần idempotent và ack sau khi hoàn tất, không ack sớm.
- Kiểm tra mọi [[time.After]] trong vòng lặp sweeper/scheduler (Go version đang dùng?), đổi sang [[context.WithTimeout]].
- Viết ADR ngắn: "Worker handler contract": recover, timeout theo message, idempotent, ack sau commit, giới hạn concurrency theo loại job.
`,
  quiz: [
    { t: 'mc', q: 'Trong select, một case đọc từ channel có giá trị nil sẽ:', o: ['Panic ngay khi select chạy', 'Được chọn ngay và trả zero value', 'Không bao giờ được chọn (block mãi) — dùng để tắt case', 'Được chọn nếu không case nào khác sẵn sàng'], a: 2, why: 'Thao tác trên channel nil block mãi, nên gán ch = nil là cách tắt một case trong select mà không cần cờ.' },
    { t: 'mc', q: 'Gửi vào một channel đã close dẫn đến:', o: ['Panic', 'Block đến khi có receiver', 'Bị bỏ qua im lặng', 'Trả về false'], a: 0, why: 'Send trên channel đã close panic; chỉ sender nên close và receiver kiểm tra ok.' },
    { t: 'mc', q: 'Goroutine A có defer recover(). A khởi chạy goroutine B bằng go f(); f panic. Kết quả?', o: ['A bắt được panic và tiếp tục', 'Chỉ goroutine B kết thúc, A chạy tiếp', 'Runtime tự chuyển panic thành error', 'Cả process chết vì recover chỉ hiệu lực trong goroutine đang panic'], a: 3, why: 'recover chỉ bắt panic của chính goroutine đó; panic không được recover ở bất kỳ goroutine nào làm process thoát.' },
    { t: 'mc', q: 'GOMEMLIMIT trong Go 1.19+ có tác dụng gì?', o: ['Giới hạn cứng, cấp phát quá sẽ panic', 'Soft limit: GC chạy dày hơn khi heap gần ngưỡng, nhưng vẫn có thể vượt nếu dữ liệu sống quá lớn', 'Giới hạn stack của goroutine', 'Thay thế hoàn toàn GOGC và tắt GC khi dưới ngưỡng'], a: 1, why: 'GOMEMLIMIT là soft limit; runtime còn chặn GC ăn quá ~50% CPU, nên live heap lớn hơn limit vẫn OOM.' },
    { t: 'mc', q: 'a := make([]int, 3, 10); b := append(a, 4); b[0] = 99. Giá trị a[0]?', o: ['0 — append luôn cấp mảng mới', '99 — a và b dùng chung mảng vì cap còn chỗ', 'Compile error', 'Panic index out of range'], a: 1, why: 'cap 10 còn chỗ nên append ghi vào cùng mảng nền; dùng a[:3:3] để ép cấp mảng mới.' },
    { t: 'fill', q: 'Điền: cờ ___ của go test/go build bật trình phát hiện data race dựa trên ThreadSanitizer, làm chương trình chậm 5–10 lần.', a: ['-race', 'race'], why: 'go test -race chỉ bắt race thực sự xảy ra lúc chạy nên cần test có concurrency thật.' },
    { t: 'fill', q: 'Điền: để kiểm tra một lỗi đã bọc nhiều lớp có phải sentinel ErrNotFound hay không, dùng errors.___(err, ErrNotFound).', a: ['is', 'errors.is'], why: 'errors.Is duyệt chuỗi Unwrap; errors.As dùng khi cần lấy ra kiểu lỗi cụ thể.' },
    { t: 'open', q: 'Thiết kế worker Go tiêu thụ RabbitMQ xử lý policy evaluation: giới hạn concurrency, chống panic, tắt êm khi Watchtower gửi SIGTERM. Trình bày 4–6 câu.', a: 'Dùng signal.NotifyContext bắt SIGTERM tạo ctx gốc; errgroup.WithContext + SetLimit(N) (N theo CPU và RAM, ví dụ 3–4 cho job nặng) để fan-out có chặn. Mỗi message chạy qua hàm bọc defer recover: panic → log kèm message id, metric, nack vào DLQ sau 3 lần. Handler nhận ctx có timeout theo message và chỉ ack sau khi commit DB; mọi bước idempotent vì có thể bị SIGKILL sau 10 s. Khi ctx hủy: channel.Cancel ngừng nhận, g.Wait chờ in-flight, rồi đóng AMQP/DB. Expose pprof nội bộ để soi heap/goroutine khi cần.', keys: ['recover', 'SetLimit', 'SIGTERM', 'ack', 'idempotent'] }
  ]
},
{ id: 'K2', type: 'knowledge', topic: 'concurrency', title: 'Bài toán đồng thời', time: '120 phút',
  goal: 'Định nghĩa và phân biệt race/deadlock/livelock/starvation, giải 5 tình huống đồng thời kinh điển bằng pattern đúng (bounded channel, lock ordering, CAS, singleflight, semaphore, SKIP LOCKED) và nói được vì sao retry song song đòi hỏi idempotency.',
  md: `
### Vấn đề cần giải
Mọi hệ backend đều có nhiều thứ chạy cùng lúc: goroutine trong một process, nhiều instance của cùng service, nhiều transaction trong DB. Người phỏng vấn muốn biết bạn **nhìn ra** bốn loại bệnh (race, deadlock, livelock, starvation), có **pattern** sẵn để trị, và hiểu rằng đồng thời không dừng ở process: hai worker cùng lấy một job, hai request retry cùng lúc, scheduler chạy trên 2 node. Sweeper của hệ SBOM lấy "100 dòng pending cũ nhất" và bị zombie chiếm chỗ mãi (sự cố #8) chính là một bài starvation ngoài đời.

### Phần 1 · Bốn loại bệnh

#### Q1. Phân biệt race condition, deadlock, livelock, starvation?
| Bệnh | Định nghĩa | Triệu chứng | Cách phát hiện | Cách trị |
|---|---|---|---|---|
| Race condition | kết quả phụ thuộc thứ tự xen kẽ không kiểm soát | dữ liệu sai thỉnh thoảng, không tái hiện | [[-race]], test lặp 1000 lần, log bất biến bị vi phạm | mutex/atomic/channel, thiết kế bất biến rõ |
| Deadlock | A giữ X chờ Y, B giữ Y chờ X | treo vĩnh viễn, CPU 0% | goroutine dump (SIGQUIT), pg_locks, "all goroutines are asleep" | lock ordering, timeout, giảm phạm vi lock |
| Livelock | các bên liên tục nhường/retry nhau, không ai tiến | CPU cao, throughput 0 | metric retry tăng vọt mà success không tăng | backoff + jitter, leader quyết định |
| Starvation | một bên không bao giờ được phục vụ dù hệ vẫn chạy | job cũ mãi pending, p99 vô hạn | tuổi job lớn nhất trong queue (oldest age) | fair queue, ưu tiên theo tuổi, cách ly dòng lỗi |
**Câu vặn:** "Tại sao race ở Go nguy hiểm hơn một kết quả sai?" → Race trên map gây fatal error không recover được; race trên slice/interface header có thể làm memory corruption → crash ngẫu nhiên khó debug.

#### Q2. Deadlock trong Postgres phát hiện và tránh thế nào?
**Trả lời mẫu:** Postgres có deadlock detector: sau [[deadlock_timeout]] (mặc định 1 s) nó kiểm tra chu trình chờ và **giết một transaction** (lỗi 40P01) kèm log hai câu lệnh liên quan. Tránh bằng: cập nhật các dòng theo **cùng thứ tự** (ORDER BY id trong SELECT FOR UPDATE), giữ transaction ngắn, không gọi API ngoài trong tx, dùng [[lock_timeout]] để fail nhanh. Ứng dụng phải retry transaction khi gặp 40P01 hoặc 40001 (serialization failure).

### Phần 2 · Pattern kinh điển

#### Q3. Producer-consumer với bounded channel: vì sao "bounded"?
**Trả lời mẫu:** Buffer vô hạn chỉ chuyển OOM từ producer sang consumer. Channel có cap N tạo **backpressure**: producer bị block (hoặc nhận lỗi nếu dùng select default) khi consumer chậm, tín hiệu đó lan ngược về nguồn (HTTP 429, ngừng poll queue). Chọn N theo thời gian phục hồi mong muốn: N ≈ throughput consumer x burst chấp nhận. Đo [[len(ch)]] theo thời gian là metric queue depth miễn phí.
**Câu vặn:** "Nếu producer là RabbitMQ thì backpressure nằm đâu?" → [[prefetch_count]] (QoS): broker chỉ giao tối đa N message chưa ack; đó là bounded buffer của bạn.

#### Q4. Readers-writers và dining philosophers: ý tưởng cốt lõi?
**Trả lời mẫu:** Readers-writers: nhiều reader song song, writer độc quyền; vấn đề là **ưu tiên ai** — reader-preferring làm writer đói, writer-preferring làm reader chờ; RWMutex của Go chặn reader mới khi có writer đang chờ (tránh writer starvation). Dining philosophers minh họa deadlock vòng tròn khi mọi người cầm đũa trái trước; lời giải: **lock ordering** (ai cũng cầm đũa số nhỏ trước) hoặc giới hạn N-1 người ngồi cùng lúc (semaphore) hoặc cầm cả hai hoặc không cầm gì (try-lock).

#### Q5. Lock granularity: coarse hay fine?
**Trả lời mẫu:** Một mutex toàn cục dễ đúng nhưng throughput kịch trần ở 1 core; chia nhỏ (lock theo shard, theo tenant, theo dòng) tăng song song nhưng mở cửa cho deadlock và bug bất biến chéo shard. Quy tắc: bắt đầu coarse, **đo contention** (mutex profile, pg_stat_activity wait_event) rồi mới chia; chia theo khóa tự nhiên (tenant id) và giữ bất biến trong một shard.

#### Q6. Lock-free, CAS, optimistic vs pessimistic?
| Tiêu chí | Pessimistic (lock, SELECT FOR UPDATE) | Optimistic (version/CAS, retry) |
|---|---|---|
| Giả định | xung đột thường xuyên | xung đột hiếm |
| Chi phí khi không xung đột | giữ lock, chờ | gần như 0 |
| Chi phí khi xung đột | hàng đợi, có thể deadlock | retry, tốn công làm lại |
| Dùng khi | cập nhật số dư, giành job | sửa document, cấu hình, counter phân tán |
| Ví dụ | FOR UPDATE SKIP LOCKED | UPDATE ... WHERE version = 7; atomic.CompareAndSwap |
**Trả lời mẫu:** CAS (compare-and-swap) là lệnh CPU nguyên tử "nếu giá trị vẫn là A thì đổi thành B"; cấu trúc lock-free xây trên CAS đảm bảo hệ thống luôn tiến (không bị một goroutine treo kéo theo), nhưng viết đúng rất khó (ABA problem) nên trong ứng dụng chỉ dùng atomic counter/flag và để lại cấu trúc lock-free cho thư viện. Trong DB, optimistic = cột [[version]] và kiểm tra rows affected = 1.

#### Q7. singleflight giải quyết gì?
**Trả lời mẫu:** Khi cache miss, 1000 request cùng key đồng loạt đi hỏi DB (cache stampede / thundering herd). [[golang.org/x/sync/singleflight]] gộp các gọi **cùng key đang bay** thành một, các request khác chờ và nhận cùng kết quả. Chỉ gộp trong một process; đa instance cần thêm lock Redis ([[SET NX PX]]) hoặc chấp nhận N lần gọi = số instance.
**Câu vặn:** "Lỗi của lần gọi gốc thì sao?" → Mọi người chờ nhận cùng lỗi; dùng [[DoChan]] kèm timeout riêng để request không bị kẹt theo người gọi đầu.

#### Q8. Semaphore giới hạn gọi API ngoài?
~~~go
sem := semaphore.NewWeighted(8) // tối đa 8 gọi ClearlyDefined đồng thời
g, ctx := errgroup.WithContext(ctx)
for _, batch := range batches {
    if err := sem.Acquire(ctx, 1); err != nil { break }
    batch := batch
    g.Go(func() error { defer sem.Release(1); return fetchBatch(ctx, batch) })
}
~~~
**Trả lời mẫu:** API ngoài có rate limit và độ trễ không kiểm soát; không chặn song song thì một đợt 10k component tạo 10k kết nối, bị 429 hoặc tự làm nghẽn ephemeral port. Semaphore (buffered channel hoặc x/sync/semaphore) + timeout per call + circuit breaker. Số 8 lấy từ rate limit nhà cung cấp chia cho số instance.

#### Q9. Retry song song và idempotency liên quan thế nào?
**Trả lời mẫu:** Retry nghĩa là cùng một ý định có thể đến **hai lần, có thể đồng thời** (client timeout rồi gửi lại trong khi request đầu vẫn đang chạy). Nếu thao tác không idempotent (INSERT, trừ tiền, publish event) sẽ nhân đôi. Giải pháp: idempotency key (unique index trên key, INSERT ... ON CONFLICT DO NOTHING rồi đọc kết quả cũ), hoặc thiết kế thao tác theo kiểu "đặt trạng thái = X" thay vì "tăng thêm 1". Trong worker: dedup theo message id với TTL, ack sau khi commit.

#### Q10. Queue trên Postgres bằng SELECT FOR UPDATE SKIP LOCKED?
~~~sql
WITH next AS (
  SELECT id FROM jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY priority DESC, run_at
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs j SET status = 'running', locked_by = $1, locked_at = now()
FROM next WHERE j.id = next.id
RETURNING j.*;
~~~
**Trả lời mẫu:** Nhiều worker chạy câu này đồng thời, mỗi worker **bỏ qua dòng người khác đang giữ** thay vì chờ → không tranh chấp, không giao trùng. Cần thêm: cột [[attempts]] và [[locked_at]] để thu hồi job của worker chết (lease hết hạn), index partial trên [[(run_at) WHERE status = 'pending']], giới hạn attempts rồi đưa vào trạng thái dead. Hợp với tải vài trăm job/s; cao hơn thì sang broker thật.
**Câu vặn:** "Vì sao không ORDER BY created_at lấy 100 dòng cũ nhất rồi xử lý?" → Chính là sự cố #8: dòng lỗi vĩnh viễn luôn cũ nhất, chiếm hết 100 slot, dòng mới đói mãi. Phải loại dòng quá attempts, hoặc xếp theo [[next_retry_at]] với backoff tăng dần.

### Phần 3 · 5 tình huống tư duy (tự trả lời trước khi đọc gợi ý)
1. Hai instance apiserver cùng chạy gocron "scan lúc 02:00" → chạy đôi. *Gợi ý:* Postgres advisory lock [[pg_try_advisory_lock(hash)]] trước khi chạy, hoặc bảng schedule với FOR UPDATE SKIP LOCKED; không có leader election thì phải có lock.
2. 1000 request cache miss cùng key "policy tenant A" đập vào DB. *Gợi ý:* singleflight trong process + lock Redis ngắn giữa instance + cache negative result.
3. Hai worker nhận cùng message (redelivery sau mất kết nối) và cùng INSERT violation. *Gợi ý:* unique index (tenant_id, policy_id, component_id, revision) + ON CONFLICT DO NOTHING; ack sau commit.
4. Publisher AMQP mất kết nối, 50 goroutine cùng phát hiện và cùng reconnect. *Gợi ý:* một goroutine reconnect (singleflight/Once theo thế hệ kết nối), các goroutine khác chờ trên channel "ready"; đây là phần thiếu trong sự cố #1.
5. Batch 100 coordinate gọi API ngoài, một coordinate lỗi làm hỏng cả batch (sự cố #7). *Gợi ý:* bulkhead: tách phần tử lỗi ra retry riêng, kết quả per-item, không để lỗi một phần tử lan sang 99 phần tử còn lại; đánh dấu failed theo item với lý do.

### Sai lầm hay gặp
- Gọi mọi bug concurrency là "race condition"; không phân biệt được livelock với deadlock.
- Nghĩ buffer channel lớn = giải quyết consumer chậm.
- Lock rồi gọi HTTP/DB bên trong critical section → lock giữ hàng trăm ms, throughput sập.
- Dùng optimistic lock nhưng không kiểm tra rows affected → lost update im lặng.
- Queue trên DB mà không có lease timeout → worker chết giữ job mãi.
- Retry không idempotency key rồi "chưa thấy trùng bao giờ" vì chưa đo.

### Nói thế nào trong phỏng vấn (EN)
- "A bounded channel gives us backpressure; an unbounded one just moves the OOM somewhere else." — Channel có giới hạn tạo backpressure; không giới hạn chỉ dời OOM đi chỗ khác.
- "To avoid deadlocks across rows we always lock in a fixed order and keep transactions short." — Tránh deadlock bằng khóa theo thứ tự cố định và tx ngắn.
- "Optimistic concurrency fits here because conflicts are rare; we check the version and retry on mismatch." — Optimistic hợp vì xung đột hiếm; kiểm tra version và retry.
- "Multiple workers can poll the same table safely with SELECT FOR UPDATE SKIP LOCKED, plus a lease to reclaim jobs from dead workers." — Nhiều worker poll an toàn bằng SKIP LOCKED, kèm lease thu hồi job của worker chết.
- "Because retries can race with the original request, every write is idempotent via a unique key." — Vì retry có thể chạy đua với request gốc nên mọi ghi đều idempotent qua unique key.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sweeper enrichment (sự cố #8): đổi "100 dòng pending cũ nhất" thành SKIP LOCKED theo [[next_retry_at]] với backoff mũ (1 phút → 1 giờ → 1 ngày), cột [[attempts]], và trạng thái [[dead]] sau 10 lần; thêm metric "tuổi dòng pending già nhất" để thấy starvation ngay.
- FetchBatch (sự cố #7): tách kết quả per-coordinate; coordinate version-range đưa vào nhánh riêng; lỗi 1 phần tử không được đánh dấu failed cho cả batch. Viết test: batch 10 có 1 phần tử lỗi → 9 success.
- gocron trên nhiều instance (sự cố #9): bọc mỗi job bằng [[pg_try_advisory_xact_lock(hashtext('scheduled-scan'))]]; không lấy được lock thì bỏ qua tick; ghi [[last_run_at]] vào bảng để tick lỡ do redeploy được chạy bù.
- Publisher RabbitMQ (sự cố #1): reconnect do đúng một goroutine đảm nhiệm; các goroutine publish chờ trên channel ready có timeout 5 s rồi trả lỗi thay vì treo; test bằng cách [[docker restart rabbitmq]] trong integration test.
- Gọi ClearlyDefined/OSV trong Lambda: semaphore 8 song song + timeout 10 s mỗi call + circuit breaker; ghi vào ADR con số lấy từ rate limit công bố của nhà cung cấp.
- Audit log (sự cố #12): publish sau commit (outbox), consumer idempotent theo event id với unique index.
- Chạy [[go test -race -count=20]] cho package queue/publisher trong CI nightly.
- Cache policy theo tenant: thêm singleflight quanh hàm load policy để tránh stampede khi Redis bị flush.
`,
  quiz: [
    { t: 'mc', q: 'Hệ thống CPU cao, metric retry tăng vọt nhưng số job hoàn thành bằng 0, không tiến trình nào treo. Đây là:', o: ['Deadlock', 'Livelock', 'Starvation', 'Data race'], a: 1, why: 'Livelock: các bên liên tục phản ứng/retry lẫn nhau mà không ai tiến; deadlock thì CPU gần 0 và treo.' },
    { t: 'mc', q: 'Cách đúng để nhiều worker cùng lấy job từ một bảng Postgres mà không giao trùng và không chờ nhau?', o: ['SELECT ... LIMIT 10 rồi UPDATE status theo id', 'LOCK TABLE jobs IN EXCLUSIVE MODE trước khi SELECT', 'Dùng isolation level SERIALIZABLE cho mọi worker', 'SELECT ... FOR UPDATE SKIP LOCKED trong cùng transaction với UPDATE'], a: 3, why: 'SKIP LOCKED bỏ qua dòng worker khác đang giữ nên không chờ, không trùng; cần thêm lease để thu hồi job của worker chết.' },
    { t: 'mc', q: 'Sweeper lấy 100 dòng pending cũ nhất mỗi lượt; vài nghìn dòng lỗi vĩnh viễn luôn cũ nhất. Hậu quả và tên gọi?', o: ['Starvation: dòng mới không bao giờ được xử lý', 'Deadlock: sweeper và DB chờ nhau', 'Livelock: sweeper retry mãi cùng 100 dòng với CPU cao', 'Race: hai sweeper cùng lấy một dòng'], a: 0, why: 'Dòng lỗi chiếm hết slot nên dòng hợp lệ đói vĩnh viễn; chữa bằng attempts/next_retry_at/trạng thái dead.' },
    { t: 'mc', q: 'singleflight trong Go phù hợp nhất để:', o: ['Giới hạn số goroutine gọi API ngoài', 'Bảo đảm chỉ một instance trong cluster chạy cron', 'Gộp các gọi cùng key đang bay trong một process thành một (chống cache stampede)', 'Thay thế mutex khi đọc nhiều ghi ít'], a: 2, why: 'singleflight dedup theo key trong process; giới hạn song song là việc của semaphore, cron cluster cần lock phân tán.' },
    { t: 'mc', q: 'Optimistic locking bằng cột version, câu lệnh UPDATE ... WHERE id = 1 AND version = 7. Điều bắt buộc phải làm thêm?', o: ['Chạy trong SERIALIZABLE', 'Kiểm tra rows affected = 1, nếu 0 thì đọc lại và retry', 'Khóa dòng bằng FOR UPDATE trước đó', 'Tăng deadlock_timeout'], a: 1, why: 'Nếu không kiểm tra rows affected, lost update xảy ra im lặng; đó là toàn bộ ý nghĩa của optimistic lock.' },
    { t: 'fill', q: 'Điền: khi 1000 request cùng miss cache và đồng loạt đập vào DB, hiện tượng này gọi là cache ___ (hoặc thundering herd).', a: ['stampede', 'cache stampede'], why: 'Chữa bằng singleflight, lock ngắn, hoặc early refresh trước khi hết TTL.' },
    { t: 'fill', q: 'Điền: lệnh CPU nguyên tử "nếu giá trị hiện tại vẫn là A thì đổi thành B" là nền tảng của cấu trúc lock-free, viết tắt là ___.', a: ['cas', 'compare-and-swap', 'compare and swap'], why: 'CAS trong Go là atomic.CompareAndSwapInt64/Pointer; cấu trúc lock-free có vấn đề ABA nên để thư viện lo.' },
    { t: 'open', q: 'Hai instance apiserver cùng chạy gocron in-memory nên scheduled scan lúc 02:00 chạy đôi, còn khi Watchtower redeploy thì lỡ tick. Đề xuất thiết kế 4–6 câu.', a: 'Chuyển lịch thành dữ liệu: bảng schedules với next_run_at, last_run_at. Mỗi tick, instance chạy một transaction SELECT ... WHERE next_run_at <= now() FOR UPDATE SKIP LOCKED (hoặc pg_try_advisory_xact_lock theo tên job) nên chỉ một instance thắng; instance kia bỏ qua. Sau khi chạy xong cập nhật last_run_at và tính next_run_at, nhờ vậy tick bị lỡ trong lúc redeploy sẽ được chạy bù ngay khi instance mới lên. Job phải idempotent vì có thể bị kill giữa chừng, và có lease/locked_at để thu hồi khi instance chết. Thêm alert nếu now - last_run_at vượt 2 chu kỳ.', keys: ['advisory lock', 'SKIP LOCKED', 'next_run_at', 'idempotent', 'alert'] }
  ]
},
{ id: 'K3', type: 'knowledge', topic: 'db', title: 'SQL và Postgres thực chiến', time: '150 phút',
  goal: 'Viết đúng 6 dạng SQL hay hỏi (window, CTE đệ quy, EXISTS, HAVING, LAG, keyset), đọc được EXPLAIN ANALYZE để nói vì sao index không được dùng, và giải thích 5 sự cố Postgres thật (partial index, FDW, statement_timeout, bloat, deadlock).',
  md: `
### Vấn đề cần giải
Phỏng vấn backend mid–senior luôn có 20–30 phút SQL: viết query, rồi "query này chậm, bạn làm gì?". Người ta không cần bạn thuộc cú pháp lạ, mà cần bạn **đọc được plan, biết index khi nào vô dụng, và hiểu Postgres vận hành** (MVCC, vacuum, lock, timeout). Hệ SBOM của bạn đã trả học phí: bảng violation 9,6 triệu dòng chỉ có index PK (sự cố #6), 696k dòng pending quét bằng phút cho đến khi có partial index (sự cố #16), FDW đóng băng schema (sự cố #5), statement_timeout 90 s ở cấp role (sự cố #4).

### Phần 1 · SQL hay hỏi

#### Q1. Các loại JOIN và khi nào dùng?
| JOIN | Trả về | Dùng khi |
|---|---|---|
| INNER | chỉ dòng khớp 2 bên | mặc định |
| LEFT | mọi dòng trái + NULL phải | "project kể cả chưa có scan"; đếm bằng COUNT(right.id) không COUNT(*) |
| FULL | hợp hai bên | đối chiếu 2 nguồn (SPDX vs CDX) |
| CROSS | tích Descartes | sinh lịch, ma trận; cẩn thận bùng nổ dòng |
| LATERAL | subquery tham chiếu dòng bên trái | "top 3 vuln mỗi component" hiệu quả hơn window khi N nhỏ |
| SEMI/ANTI (EXISTS / NOT EXISTS) | lọc theo tồn tại, không nhân dòng | thay IN khi tập con lớn, thay LEFT JOIN ... IS NULL |
**Câu vặn:** "LEFT JOIN rồi WHERE right.col = 'x' thì sao?" → Thành INNER JOIN vì NULL không thoả WHERE; điều kiện phải đặt trong ON.

#### Q2. GROUP BY/HAVING và window function khác nhau thế nào?
**Trả lời mẫu:** GROUP BY **gộp** dòng (mất chi tiết), HAVING lọc sau khi gộp. Window function **giữ nguyên số dòng** và tính thêm cột theo cửa sổ: [[ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY cnt DESC)]] để lấy top-N mỗi nhóm, [[LAG(x) OVER (ORDER BY day)]] để so với dòng trước, [[SUM(x) OVER (ORDER BY day)]] là running total. Window không lọc được trực tiếp trong WHERE → bọc CTE rồi WHERE rn <= 3.

#### Q3. CTE và CTE đệ quy?
**Trả lời mẫu:** CTE ([[WITH]]) đặt tên cho subquery; từ Postgres 12 CTE không có side effect được inline (không còn là optimization fence) trừ khi [[MATERIALIZED]]. Đệ quy: phần anchor UNION ALL phần đệ quy tham chiếu chính nó, dùng cho cây phụ thuộc, org chart, đường đi; luôn có cột depth và chặn depth < 20 hoặc mảng path để tránh vòng lặp vô hạn.

#### Q4. EXISTS vs IN vs JOIN?
**Trả lời mẫu:** [[IN (subquery)]] và [[EXISTS]] đều được planner biến thành semi-join; khác biệt thật: [[NOT IN]] với subquery có NULL trả **rỗng** (ba trạng thái logic) → dùng NOT EXISTS. JOIN nhân dòng nếu bên phải trùng; EXISTS không. Với danh sách literal lớn (10k id) dùng [[= ANY($1::bigint[])]] một tham số thay vì 10k placeholder.

#### Q5. N+1 là gì và sửa thế nào?
**Trả lời mẫu:** Lấy 100 project (1 query) rồi mỗi project 1 query lấy owner → 101 round trip, 50 ms mỗi trang dù mỗi query 0,5 ms. Sửa: (a) JOIN một query; (b) batch: gom id rồi [[WHERE id = ANY($1)]] và map lại ở app (ORM gọi là Preload theo batch); (c) dataloader gom trong một tick cho GraphQL. Nhưng Preload **toàn bộ** quan hệ không giới hạn là N+1 đảo ngược: sự cố #3 kéo 490k vulnerability vào RAM. Luôn kèm LIMIT hoặc chỉ cột cần.

### Phần 2 · Postgres vận hành

#### Q6. Đọc EXPLAIN (ANALYZE, BUFFERS) thế nào?
**Trả lời mẫu:** Mỗi node có [[cost=startup..total]] (đơn vị ước lượng, seq_page_cost = 1), [[rows=]] ước lượng vs [[actual rows=]] và [[loops=]] (actual là **mỗi loop**, nhân lên!). Lệch 10 lần trở lên → thống kê cũ ([[ANALYZE]]) hoặc tương quan cột ([[CREATE STATISTICS]]). [[Buffers: shared hit/read]]: read lớn là đọc đĩa. Join: **Nested Loop** tốt khi outer nhỏ và inner có index; **Hash Join** cho equi-join tập lớn chưa sắp xếp (build hash phía nhỏ, cần work_mem); **Merge Join** khi hai bên đã sắp xếp. [[Sort Method: external merge Disk]] → tăng work_mem cho session đó. Dùng explain.dalibo.com hoặc explain.depesz.com để đọc plan dài.

#### Q7. Khi nào index KHÔNG được dùng?
| Nguyên nhân | Ví dụ | Sửa |
|---|---|---|
| Hàm trên cột | WHERE lower(email) = $1 | expression index trên lower(email) hoặc citext |
| Lệch kiểu | cột varchar, tham số int → cast ngầm | ép kiểu tham số đúng, kiểm tra driver |
| Wildcard đầu | LIKE '%log4j%' | pg_trgm GIN index |
| Độ chọn lọc thấp | status = 'done' chiếm 95% | planner chọn seq scan là đúng; partial index cho giá trị hiếm |
| OR qua nhiều cột | a = 1 OR b = 2 | BitmapOr nếu có index cả hai, hoặc UNION |
| Thống kê cũ, bảng nhỏ | sau import lớn | ANALYZE; bảng vài trăm dòng seq scan nhanh hơn |
| Cột đầu composite không có trong WHERE | index (tenant_id, created_at), WHERE created_at > ... | thêm tenant_id hoặc index riêng |

#### Q8. Thứ tự cột trong composite index, partial và covering index?
**Trả lời mẫu:** Quy tắc: cột **equality trước, range sau**, cột ORDER BY cuối để tránh Sort; index (a, b) phục vụ WHERE a, WHERE a AND b, không phục vụ WHERE b. **Partial index** [[CREATE INDEX ... WHERE status = 'pending']] chỉ chứa dòng hiếm → nhỏ hơn hàng trăm lần và luôn "nóng"; sự cố #16: 696k dòng pending trong bảng vài triệu, query ListAllPending chạy 54–489 s xuống ms sau khi tạo partial index. **Covering index** [[INCLUDE (cols)]] cho Index Only Scan, nhưng chỉ nhanh khi visibility map sạch (vacuum đều). Sự cố #6: bảng 9,6 triệu dòng chỉ có PK, 238 policy quét liên tục → mỗi lần đánh giá là seq scan 9,6 triệu dòng → CPU 4 vCPU 100%, 55% request 500; thêm index (policy_id, target_id) và giới hạn vòng đánh giá là đủ cứu.
**Câu vặn:** "Index nhiều có hại gì?" → Mỗi index là một cây B-tree phải cập nhật khi INSERT/UPDATE (write amplification), chiếm RAM shared_buffers, chặn HOT update; bảng ghi nhiều giữ 3–5 index là giới hạn thực tế. Kiểm tra [[pg_stat_user_indexes.idx_scan = 0]] để xoá index thừa.

#### Q9. Deadlock trong Postgres: log ra sao, tránh thế nào?
**Trả lời mẫu:** Sau [[deadlock_timeout]] 1 s, Postgres huỷ một tx, log "Process 123 waits for ShareLock on transaction 456; blocked by process 789" kèm hai câu lệnh. Bật [[log_lock_waits]] để thấy cả chờ dài không thành deadlock. Tránh: cập nhật theo thứ tự id tăng dần, tx ngắn, không gọi API ngoài trong tx, [[lock_timeout]] 5 s để fail nhanh, app retry 40P01.

#### Q10. VACUUM, bloat, xid wraparound là gì?
**Trả lời mẫu:** MVCC: UPDATE/DELETE không xoá dòng cũ mà đánh dấu dead tuple; VACUUM dọn để tái dùng chỗ (không trả lại OS; VACUUM FULL mới trả nhưng khoá bảng). Autovacuum mặc định chờ dead tuple đạt 20% bảng ([[autovacuum_vacuum_scale_factor = 0.2]]): bảng 10 triệu dòng phải có 2 triệu dead mới dọn → **bloat**, index phình, Index Only Scan mất tác dụng; bảng lớn hay cập nhật nên set per-table 0.01–0.02. Xid 32-bit: sau ~2 tỷ transaction phải freeze, không freeze kịp thì DB **từ chối ghi** để bảo vệ dữ liệu; theo dõi [[age(datfrozenxid)]] cảnh báo > 1 tỷ.

#### Q11. Partitioning khi nào đáng?
**Trả lời mẫu:** Bảng > vài trăm triệu dòng hoặc > 100 GB, truy vấn luôn lọc theo khoá phân vùng (thời gian, tenant), cần **xoá theo lô** (DROP PARTITION tức thì thay vì DELETE hàng giờ). Giá: unique constraint phải chứa khoá phân vùng, FK trỏ vào bảng phân vùng hạn chế, planner tốn thêm khi quá nhiều partition (giữ dưới vài nghìn), query không có khoá phân vùng quét mọi partition.

#### Q12. FDW: bẫy gì? (sự cố #5, #11)
**Trả lời mẫu:** postgres_fdw lưu **bản sao định nghĩa cột** lúc IMPORT FOREIGN SCHEMA; remote thêm cột thì local không thấy → 500 "column does not exist" sau migration (sự cố #5); phải [[ALTER FOREIGN TABLE ... ADD COLUMN]] hoặc IMPORT lại. JOIN giữa bảng local và bảng foreign **không push down**: Postgres kéo bảng remote về (fetch_size mặc định 100 dòng mỗi lượt) rồi join tại chỗ → export join FDW chậm và ngốn RAM (sự cố #11). Ước lượng dòng remote sai vì [[use_remote_estimate]] mặc định off. Giải pháp: materialized view/bảng cache đồng bộ định kỳ, hoặc chuyển join sang phía remote bằng view ở remote, hoặc API thay FDW.

#### Q13. statement_timeout đặt ở đâu? (sự cố #4)
**Trả lời mẫu:** Có 4 cấp: postgresql.conf → [[ALTER ROLE ... SET]] → [[ALTER DATABASE]] → session/[[SET LOCAL]] trong tx. Giá trị role 90 s áp cho **mọi** câu lệnh của role đó; code chỉ [[SET LOCAL statement_timeout]] trong transaction nên câu chạy ngoài tx (autocommit) vẫn bị cắt. Đúng cách: role riêng cho batch/worker với timeout dài, API dùng role timeout ngắn; hoặc set ở connection hook của pool ([[AfterConnect]]); kết hợp [[idle_in_transaction_session_timeout]] để khỏi giữ lock mãi.

#### Q14. Keyset pagination và upsert?
~~~sql
-- keyset: không OFFSET; cần index (created_at DESC, id DESC)
SELECT * FROM components WHERE tenant_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC LIMIT 50;
-- upsert chỉ ghi khi dữ liệu mới hơn
INSERT INTO comp_license (comp_id, license, updated_at) VALUES ($1, $2, now())
ON CONFLICT (comp_id) DO UPDATE SET license = EXCLUDED.license, updated_at = now()
WHERE comp_license.updated_at < EXCLUDED.updated_at
RETURNING (xmax = 0) AS inserted;
~~~
**Trả lời mẫu:** OFFSET N đọc và vứt N dòng → trang 1000 chậm gấp 1000 lần trang 1, và dòng xen vào làm trùng/sót (sự cố #11). Keyset dùng con trỏ (giá trị cuối trang) nên mỗi trang O(limit). Upsert cần unique index trên cột ON CONFLICT; [[DO NOTHING]] khi chỉ muốn idempotent.

### Phần 3 · 6 bài SQL mẫu
1. **Top 3 component nhiều vuln nhất mỗi tenant.**
~~~sql
WITH c AS (SELECT tenant_id, component_id, COUNT(*) cnt FROM component_vulns GROUP BY 1, 2),
r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY cnt DESC) rn FROM c)
SELECT tenant_id, component_id, cnt FROM r WHERE rn <= 3;
~~~
2. **Project chưa có scan nào trong 7 ngày (kể cả chưa từng scan).**
~~~sql
SELECT p.id FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.project_id = p.id AND s.finished_at > now() - interval '7 days');
~~~
3. **Running total vuln phát hiện theo ngày.**
~~~sql
SELECT day, n, SUM(n) OVER (ORDER BY day) AS running_total
FROM (SELECT date_trunc('day', found_at) day, COUNT(*) n FROM vulns GROUP BY 1) t;
~~~
4. **Cây phụ thuộc từ component gốc, tối đa 10 tầng.**
~~~sql
WITH RECURSIVE tree AS (
  SELECT child_id, 1 AS depth, ARRAY[child_id] AS path FROM deps WHERE parent_id = $1
  UNION ALL
  SELECT d.child_id, t.depth + 1, t.path || d.child_id FROM deps d JOIN tree t ON d.parent_id = t.child_id
  WHERE t.depth < 10 AND NOT d.child_id = ANY(t.path))
SELECT DISTINCT child_id, MIN(depth) FROM tree GROUP BY 1;
~~~
5. **purl trùng trong cùng revision.** [[SELECT revision_id, purl, COUNT(*) FROM components GROUP BY 1, 2 HAVING COUNT(*) > 1;]]
6. **Số critical thay đổi so với revision liền trước của mỗi project.**
~~~sql
SELECT project_id, revision_id, critical,
       critical - LAG(critical) OVER (PARTITION BY project_id ORDER BY created_at) AS delta
FROM project_metrics;
~~~

### Sai lầm hay gặp
- COUNT(*) sau LEFT JOIN đếm cả dòng NULL → project chưa có vuln vẫn ra 1.
- NOT IN với subquery chứa NULL → kết quả rỗng âm thầm.
- Đọc EXPLAIN mà quên nhân actual rows với loops; đổ lỗi "index không chạy" khi planner đúng là seq scan rẻ hơn.
- Tạo index ngay trên bảng lớn production không [[CONCURRENTLY]] → khoá ghi hàng phút.
- Preload/JOIN kéo toàn bộ quan hệ không LIMIT → OOM (sự cố #3).
- Coi FDW như bảng local; join local–remote trong request path.
- Đặt timeout một con số cho mọi loại tải (API 90 s cũng dở, batch 90 s cũng dở).

### Nói thế nào trong phỏng vấn (EN)
- "I'd start with EXPLAIN ANALYZE with BUFFERS and compare estimated versus actual rows per loop." — Bắt đầu bằng EXPLAIN ANALYZE BUFFERS, so rows ước lượng và thực tế theo loop.
- "A partial index on the pending rows keeps the index tiny and hot; it took that query from minutes to milliseconds." — Partial index trên dòng pending giữ index nhỏ và nóng; query từ phút xuống ms.
- "Equality columns first, range columns last, and the ORDER BY column at the end so we avoid a sort." — Cột equality trước, range sau, ORDER BY cuối để khỏi sort.
- "Keyset pagination is O(page size) regardless of depth, whereas OFFSET scans and discards everything before it." — Keyset O(kích thước trang) bất kể độ sâu; OFFSET quét và vứt mọi thứ phía trước.
- "A join between a local and a foreign table can't be pushed down, so we cache the remote data locally instead." — Join local–foreign không push down nên cache dữ liệu remote tại chỗ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Partial index [[idx_prcl_pending_rev]] mới tạo tay trên Canary RDS: đưa vào migration ([[CREATE INDEX CONCURRENTLY IF NOT EXISTS]]) để môi trường khác không lệch; kiểm tra bằng EXPLAIN ANALYZE trước/sau và ghi hai con số vào ticket.
- Bảng policy violation 9,6 triệu dòng (sự cố #6): chạy [[pg_stat_user_tables]] để xem seq_scan vs idx_scan; thêm index (policy_id, target_id) và (target_id) WHERE deleted_at IS NULL; set [[autovacuum_vacuum_scale_factor = 0.01]] cho bảng này.
- Export (sự cố #11): đổi OFFSET sang keyset theo (created_at, id); stream từng trang ra file thay vì ReadAll; bỏ join FDW trong request path, thay bằng bảng cache vuln được sync định kỳ.
- FDW (sự cố #5): viết checklist release "sau migration DB vuln → ALTER FOREIGN TABLE / IMPORT FOREIGN SCHEMA trên DB tenant"; thêm smoke test gọi API đọc cột mới.
- statement_timeout (sự cố #4): tạo role [[sbom_batch]] timeout 15 phút cho worker/Lambda, role [[sbom_api]] 30 s cho apiserver; bỏ phụ thuộc SET LOCAL.
- Bật [[log_min_duration_statement = 1000]], [[log_lock_waits = on]] trên Canary một tuần; gom top 10 query chậm từ [[pg_stat_statements]] làm backlog tối ưu.
- Theo dõi [[age(datfrozenxid)]] và dead tuple ratio của 5 bảng lớn nhất trên dashboard; cảnh báo age > 1 tỷ.
- Viết lại query ListAllPending thành SKIP LOCKED theo next_retry_at (K2) và kiểm tra plan dùng partial index.
`,
  quiz: [
    { t: 'mc', q: 'Query WHERE status = \'pending\' trên bảng 5 triệu dòng, chỉ 0,5% là pending, nhưng planner vẫn seq scan dù có index trên status. Khả năng cao nhất?', o: ['Postgres không hỗ trợ index trên cột text', 'Index B-tree chỉ dùng được cho so sánh số', 'Phải dùng hash index cho phép so sánh bằng', 'Thống kê cũ (chưa ANALYZE) nên planner nghĩ pending chiếm tỉ lệ lớn'], a: 3, why: 'Với 0,5% dòng index rất đáng dùng; planner chọn seq scan vì ước lượng sai do thống kê lạc hậu hoặc phân phối lệch; ANALYZE rồi xem lại rows ước lượng.' },
    { t: 'mc', q: 'EXPLAIN ANALYZE hiện Index Scan ... (actual rows=50 loops=2000) bên trong Nested Loop. Số dòng thực tế node này trả về tổng cộng?', o: ['100 000', '50', '2 000', '2 050'], a: 0, why: 'actual rows là trung bình mỗi loop; tổng = rows x loops = 100k, dấu hiệu nested loop với outer quá lớn.' },
    { t: 'mc', q: 'Sau khi DB vulnerability (remote) thêm cột severity_v4, API ở DB tenant trả 500 "column severity_v4 does not exist" khi query qua foreign table. Nguyên nhân?', o: ['Postgres_fdw không hỗ trợ cột mới thêm bằng ALTER', 'Quyền SELECT trên cột mới chưa cấp cho role FDW', 'Foreign table lưu định nghĩa cột lúc import, phải ALTER FOREIGN TABLE hoặc IMPORT lại', 'Cần restart Postgres tenant để nạp lại schema'], a: 2, why: 'postgres_fdw giữ bản sao định nghĩa cột cục bộ; thay đổi remote không tự lan sang.' },
    { t: 'mc', q: 'statement_timeout = 90s được đặt bằng ALTER ROLE. Code chỉ SET LOCAL statement_timeout = 0 trong transaction. Câu lệnh nào vẫn bị cắt sau 90 s?', o: ['Mọi câu lệnh trong transaction đó', 'Câu lệnh chạy ở chế độ autocommit ngoài transaction', 'Không câu nào, SET LOCAL ghi đè vĩnh viễn cho session', 'Chỉ câu lệnh DDL'], a: 1, why: 'SET LOCAL chỉ hiệu lực đến hết transaction hiện tại; câu autocommit dùng giá trị role 90 s.' },
    { t: 'mc', q: 'Vì sao NOT IN (SELECT owner_id FROM projects) có thể trả về 0 dòng dù rõ ràng có user không sở hữu project?', o: ['Nếu subquery chứa NULL, so sánh x <> NULL là UNKNOWN nên không dòng nào thoả', 'Postgres giới hạn subquery trong NOT IN ở 1000 dòng', 'NOT IN luôn cần index unique trên owner_id', 'Planner chuyển NOT IN thành INNER JOIN'], a: 0, why: 'Logic ba trạng thái của SQL; dùng NOT EXISTS để tránh.' },
    { t: 'fill', q: 'Điền: index chỉ chứa các dòng thoả một điều kiện WHERE (ví dụ status = \'pending\'), nhỏ hơn nhiều so với index đầy đủ, gọi là ___ index.', a: ['partial', 'partial index'], why: 'Partial index giúp query ListAllPending trong hệ SBOM từ phút xuống ms (sự cố #16).' },
    { t: 'fill', q: 'Điền: để tạo index trên bảng lớn đang phục vụ production mà không khoá ghi, dùng CREATE INDEX ___.', a: ['concurrently', 'create index concurrently'], why: 'CONCURRENTLY tốn thời gian hơn và không chạy trong transaction, nhưng không chặn INSERT/UPDATE.' },
    { t: 'open', q: 'Trang export component dùng OFFSET, join qua FDW sang DB vulnerability và ReadAll vào RAM; trang cuối mất 40 s và worker tốn 2 GB. Trình bày cách sửa 4–6 câu.', a: 'Thay OFFSET bằng keyset pagination theo (created_at, id) với index khớp để mỗi trang O(limit). Bỏ join FDW trong request path vì join local–foreign không push down và kéo toàn bộ bảng remote về; thay bằng bảng cache vuln đồng bộ định kỳ hoặc batch lookup theo id list. Stream kết quả ra file/HTTP theo từng trang thay vì ReadAll, giữ RAM hằng số. Đặt statement_timeout dài hơn cho role export nhưng vẫn hữu hạn, và đo bằng EXPLAIN ANALYZE BUFFERS trước/sau để ghi số liệu vào ticket.', keys: ['keyset', 'FDW', 'push down', 'stream', 'EXPLAIN'] }
  ]
},
{ id: 'K4', type: 'knowledge', topic: 'design', title: 'Low-level design / OOD', time: '120 phút',
  goal: 'Trình bày một bài LLD 30 phút theo khung requirements → entities → interfaces → core algorithm → extensibility; viết được LRU cache O(1), rate limiter object và pub/sub in-process bằng Go; giải thích SOLID và 7 pattern bằng ví dụ Go idiomatic.',
  md: `
### Vấn đề cần giải
Vòng LLD (low-level design / OOD) kiểm tra việc bạn **biến yêu cầu mơ hồ thành lớp, interface và thuật toán** chạy được trong 30–45 phút, có mở rộng được và có test được. Khác với system design (hộp và mũi tên), ở đây người ta nhìn vào cách bạn đặt ranh giới interface, xử lý concurrency và chọn cấu trúc dữ liệu. Với Go, câu trả lời idiomatic khác Java: interface nhỏ, composition, không có class hierarchy.

### Phần 1 · Nguyên tắc

#### Q1. SOLID trong Go trông thế nào?
| Nguyên tắc | Ý nghĩa trong Go | Dấu hiệu vi phạm |
|---|---|---|
| S — Single responsibility | một package/struct một lý do để đổi | struct Service 3 000 dòng gọi DB, HTTP, gửi mail |
| O — Open/closed | mở rộng bằng interface + thêm implementation, không sửa switch | switch kiểu lan khắp nơi mỗi khi thêm loại SBOM mới |
| L — Liskov | implementation phải giữ hợp đồng interface (kể cả lỗi, nil) | mock trả nil, thật trả lỗi; Reader trả 0 byte mãi |
| I — Interface segregation | interface 1–3 method định nghĩa **ở phía dùng** | interface Repository 40 method, mock phải viết đủ 40 |
| D — Dependency inversion | service nhận interface qua constructor (DI thủ công) | gọi [[db.Conn()]] global trong service, không test được |
**Trả lời mẫu:** Go thực hành SOLID qua **interface ngầm** (implicit): [[io.Reader]] một method là ví dụ tiêu biểu của I và D. DI làm bằng tay ở main.go hoặc wire/fx; không cần framework.
**Câu vặn:** "Interface đặt ở package nào?" → Ở package **tiêu thụ**, không ở package implement; nhờ vậy package DB không biết gì về service, và service chỉ khai báo đúng method mình dùng.

#### Q2. Composition over inheritance trong Go?
**Trả lời mẫu:** Go không có kế thừa; **embedding** chỉ là composition có đường tắt gọi method (không có override, không có polymorphism qua embedding). Muốn đa hình thì dùng interface. Ưu điểm: không có fragile base class; nhược: không dùng được "template method" kiểu Java → thay bằng truyền hàm/strategy.

#### Q3. 7 pattern hay hỏi: khi nào dùng, Go viết sao, khi nào không?
| Pattern | Vấn đề | Trong Go | Không dùng khi |
|---|---|---|---|
| Strategy | đổi thuật toán lúc chạy (parser CycloneDX vs SPDX) | interface [[Parser]] + map format → impl | chỉ có 1 thuật toán, thêm interface là over-engineering |
| Factory | tạo đối tượng theo cấu hình (client OSV/NVD/GHSA) | hàm [[NewSource(kind) (Source, error)]] | đối tượng khởi tạo đơn giản → literal |
| Observer | thông báo nhiều bên khi sự kiện xảy ra | channel/callback đăng ký; event bus | cần bền vững → dùng message queue |
| Adapter | ghép interface bên thứ ba vào interface của mình | struct bọc SDK AWS, implement [[Storage]] | chỉ một chỗ gọi |
| Decorator | thêm hành vi (log, retry, cache, metric) không sửa lõi | hàm nhận và trả cùng interface: [[WithRetry(s Source) Source]] | chuỗi decorator quá sâu khó debug |
| Repository | tách truy cập dữ liệu khỏi nghiệp vụ | interface theo nhu cầu service, impl Postgres | CRUD thuần, repo chỉ là lớp chuyển tiếp 1:1 ORM |
| Circuit breaker | ngừng gọi dịch vụ đang chết để không kéo mình chết theo | trạng thái closed/open/half-open, ngưỡng lỗi, thời gian mở | gọi nội bộ tin cậy, retry ngắn là đủ |
**Câu vặn:** "Decorator khác middleware HTTP?" → Cùng ý tưởng: [[func(http.Handler) http.Handler]] là decorator trên interface Handler.

### Phần 2 · Bốn bài LLD kinh điển

#### Q4. Thiết kế LRU cache O(1) cho Get và Put
~~~go
type entry struct { key string; val any }
type LRU struct {
    cap int
    ll  *list.List               // front = mới dùng nhất, back = nạn nhân
    idx map[string]*list.Element // key -> node, O(1)
    mu  sync.Mutex
}
func (c *LRU) Get(k string) (any, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    if e, ok := c.idx[k]; ok { c.ll.MoveToFront(e); return e.Value.(*entry).val, true }
    return nil, false
}
func (c *LRU) Put(k string, v any) {
    c.mu.Lock(); defer c.mu.Unlock()
    if e, ok := c.idx[k]; ok { e.Value.(*entry).val = v; c.ll.MoveToFront(e); return }
    c.idx[k] = c.ll.PushFront(&entry{k, v})
    if c.ll.Len() > c.cap {
        last := c.ll.Back(); c.ll.Remove(last); delete(c.idx, last.Value.(*entry).key)
    }
}
~~~
**Trả lời mẫu:** map cho tra cứu O(1), doubly linked list cho di chuyển/xoá O(1); hai cấu trúc trỏ chéo nhau. Thread-safe bằng một mutex (cache nhỏ, critical section vài chục ns, đủ); cache lớn nhiều core thì shard theo hash(key) thành 16–64 LRU con.
**Câu vặn:** "Thêm TTL?" → lưu [[expireAt]] trong entry, kiểm tra khi Get (lazy) + goroutine quét định kỳ; "LFU?" → O(1) LFU cần map tần suất → danh sách node theo tần suất (bài báo O(1) LFU); "Hit ratio thấp thì sao?" → đo, đổi sang ARC/W-TinyLFU (thư viện ristretto) thay vì tự viết.

#### Q5. Parking lot trong 15 phút
**Trả lời mẫu:** Requirements: nhiều tầng, 3 cỡ chỗ (motorbike/compact/large), xe to không vào chỗ nhỏ, xe nhỏ có thể vào chỗ to, vé vào/ra, tính tiền theo giờ. Entities: [[ParkingLot]] (floors), [[Floor]] (spots theo cỡ), [[Spot]] (id, size, occupied), [[Vehicle]] (plate, size), [[Ticket]] (id, spot, in, out). Interfaces: [[SpotAllocator]] (chọn chỗ: gần nhất, cùng cỡ trước), [[PricingStrategy]] (theo giờ, theo ngày, theo cỡ). Core algorithm: mỗi floor giữ **free list theo cỡ** (slice hoặc heap theo khoảng cách) → allocate O(1)/O(log n); mutex theo floor. Extensibility: thêm EV spot = thêm size + strategy, không sửa lõi; nhiều cổng = allocator dùng lock theo floor.

#### Q6. Rate limiter object
~~~go
type Limiter interface { Allow(key string) bool }
type bucket struct { tokens float64; last time.Time }
type TokenBucket struct { rate, burst float64; mu sync.Mutex; b map[string]*bucket }
func (t *TokenBucket) Allow(key string) bool {
    t.mu.Lock(); defer t.mu.Unlock()
    b := t.b[key]
    if b == nil { b = &bucket{tokens: t.burst, last: time.Now()}; t.b[key] = b }
    now := time.Now()
    b.tokens = math.Min(t.burst, b.tokens + now.Sub(b.last).Seconds()*t.rate); b.last = now
    if b.tokens < 1 { return false }
    b.tokens--; return true
}
~~~
**Trả lời mẫu:** Token bucket (rate r, burst b) nạp lười khi có request → không cần goroutine nạp; bộ nhớ O(số key) nên cần dọn key cũ (LRU ở Q4!). Interface [[Limiter]] cho phép đổi sang sliding window hoặc Redis-backed khi chạy nhiều instance mà không đổi caller.
**Câu vặn:** "Nhiều instance thì sao?" → Local limiter chỉ đúng per-instance; cần Redis + script Lua nguyên tử, hoặc chấp nhận giới hạn ≈ N x r.

#### Q7. Pub/sub in-process
**Trả lời mẫu:** [[type Bus interface { Subscribe(topic string, buf int) (<-chan Event, func()); Publish(topic string, e Event) }]]. Mỗi subscriber một buffered channel; Publish duyệt danh sách dưới RWMutex và **gửi non-blocking** (select default): subscriber chậm bị drop event + metric, hoặc chính sách block với timeout tuỳ yêu cầu — phải nói rõ lựa chọn này. Unsubscribe trả hàm đóng channel và xoá khỏi danh sách; sender là bus nên bus close. Khi cần bền vững/đa process → RabbitMQ, không tự viết.

### Phần 3 · Kiến trúc và cách trình bày

#### Q8. Clean / hexagonal architecture trong service Go?
**Trả lời mẫu:** Ba lớp: **handler** (HTTP/AMQP, decode, validate, map lỗi → status) → **service** (nghiệp vụ, transaction boundary, không biết HTTP) → **repository** (SQL, không biết nghiệp vụ). Quy tắc phụ thuộc hướng vào trong: domain không import infra; interface repo khai báo ở service. Lợi: test service bằng fake repo trong ms, đổi DB không chạm nghiệp vụ. Giá: thêm mapping struct giữa lớp. Tránh **anemic model** quá mức: struct chỉ có field + service 5 000 dòng; đưa quy tắc bất biến (ví dụ [[Policy.Validate()]], [[Revision.CanPublish()]]) vào domain type. Nhưng cũng không cuồng DDD cho CRUD đơn giản: 3 lớp là đủ, không 7 lớp.

#### Q9. Dẫn dắt 30 phút LLD thế nào?
| Phút | Việc | Đầu ra |
|---|---|---|
| 0–5 | làm rõ requirements, scale, concurrency, ngoài phạm vi | 4–6 gạch đầu dòng, xác nhận với interviewer |
| 5–10 | entities + quan hệ | 4–8 struct, field chính |
| 10–15 | interfaces & API công khai | 2–4 interface nhỏ, chữ ký method |
| 15–25 | core algorithm + cấu trúc dữ liệu + concurrency | code phần khó nhất, độ phức tạp |
| 25–30 | extensibility, test, trade-off | "để thêm X chỉ cần..."; 3 test case |
**Trả lời mẫu:** Nói to lựa chọn và lý do, viết code phần lõi thật, phần râu ria chỉ chữ ký. Luôn kết bằng: giới hạn hiện tại là gì và bước tiếp theo nếu có thêm thời gian.

### Sai lầm hay gặp
- Vẽ class diagram 15 lớp trước khi hỏi yêu cầu; không chốt được "ngoài phạm vi".
- Interface to, định nghĩa ở package implement; mock phải viết 40 method.
- Abstraction cho tương lai không ai cần (Factory của Factory); không nói được "khi nào không dùng pattern này".
- Quên concurrency: LRU không mutex, pub/sub block vì một subscriber chậm.
- Không nêu độ phức tạp và không viết test case nào.
- Anemic model cực đoan hoặc DDD cực đoan cho một CRUD.

### Nói thế nào trong phỏng vấn (EN)
- "Let me confirm the requirements and what's out of scope before I pick the data structures." — Xác nhận yêu cầu và phạm vi trước khi chọn cấu trúc dữ liệu.
- "In Go I'd keep interfaces small and define them on the consumer side, so the service only depends on what it uses." — Interface nhỏ, định nghĩa phía dùng; service chỉ phụ thuộc thứ nó cần.
- "A map plus a doubly linked list gives O(1) get and put; I'll shard it if lock contention shows up." — Map cộng danh sách liên kết đôi cho O(1); shard nếu thấy tranh chấp lock.
- "I'd rather add a Strategy interface here than a switch, because we already know a third format is coming." — Thêm Strategy thay vì switch vì biết chắc định dạng thứ ba sắp tới.
- "I'd stop at three layers; more abstraction isn't justified by the requirements." — Dừng ở ba lớp; thêm abstraction không được yêu cầu biện minh.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Parser SBOM: kiểm tra có đang switch theo format rải rác không; gom về [[type Parser interface { Parse(ctx, r io.Reader) (*BOM, error) }]] + registry theo format/version để thêm CycloneDX 1.7 không đụng lõi.
- Nguồn vulnerability (OSV, NVD, GHSA, EUVD, JVNDB): interface [[Source]] nhỏ (Fetch, Name) + decorator [[WithRetry]], [[WithCircuitBreaker]], [[WithMetrics]] chung thay vì mỗi client tự viết retry khác nhau; FetchBatch (sự cố #7) sẽ dễ test per-item hơn.
- Policy parser từng panic vì type rỗng: đưa validation vào domain type [[Condition.Validate()]] gọi ở cả API tạo policy lẫn worker; đó là chống anemic model đúng chỗ.
- Cache trong apiserver (policy theo tenant, license map): nếu đang dùng map + mutex không giới hạn thì thay bằng LRU có cap + TTL theo mẫu Q4, đo hit ratio bằng metric.
- Rate limiter gọi API ngoài trong Lambda: interface [[Limiter]] để local token bucket hiện tại có thể đổi sang Redis khi chạy nhiều Lambda song song.
- Repository: rà xem có interface Repository 30+ method không; tách theo use case (ReadRepo cho export, WriteRepo cho import) để mock gọn.
- Tự luyện: dùng khung Q9 thiết kế lại "Enrichment pipeline" như một bài LLD 30 phút, viết interface và test case cho sweeper.
`,
  quiz: [
    { t: 'mc', q: 'Trong Go, interface nên được khai báo ở đâu để tuân theo Interface Segregation và Dependency Inversion?', o: ['Trong package implement, cạnh struct', 'Trong một package interfaces chung của toàn repo', 'Ở package tiêu thụ, chỉ gồm method mà nơi đó dùng', 'Trong package main để tiện DI'], a: 2, why: 'Interface ngầm của Go cho phép phía dùng tự khai báo đúng hợp đồng cần thiết; package implement không cần biết.' },
    { t: 'mc', q: 'LRU cache cần Get và Put đều O(1). Cặp cấu trúc dữ liệu phù hợp?', o: ['Hash map + doubly linked list', 'Hash map + min-heap theo thời gian truy cập', 'Slice sắp xếp + binary search', 'Balanced BST + queue'], a: 0, why: 'Map tra cứu O(1), danh sách liên kết đôi di chuyển/xoá node O(1); heap làm Get thành O(log n).' },
    { t: 'mc', q: 'Pattern nào phù hợp để thêm retry, metric và log quanh client gọi OSV mà không sửa client?', o: ['Factory', 'Observer', 'Repository', 'Decorator'], a: 3, why: 'Decorator nhận và trả cùng interface Source, xếp chồng được; middleware HTTP cũng là decorator.' },
    { t: 'mc', q: 'Embedding struct trong Go khác kế thừa ở điểm cốt lõi nào?', o: ['Embedding cho phép override method của struct được nhúng', 'Embedding chỉ là composition có đường tắt gọi method; đa hình phải qua interface', 'Embedding tạo quan hệ is-a được type system kiểm tra', 'Không khác, chỉ là cú pháp'], a: 1, why: 'Method của struct nhúng được promote nhưng không có dynamic dispatch về phía struct ngoài.' },
    { t: 'mc', q: 'Pub/sub in-process có một subscriber xử lý chậm. Nếu Publish gửi blocking vào channel của nó, hậu quả?', o: ['Chỉ subscriber đó mất event', 'Runtime tự tăng buffer channel', 'Event được xếp hàng trên đĩa', 'Publisher và mọi subscriber khác bị kẹt theo'], a: 3, why: 'Publish tuần tự qua danh sách nên một channel đầy chặn toàn bộ; phải chọn chính sách drop hoặc timeout và nói rõ trade-off.' },
    { t: 'fill', q: 'Điền: nguyên tắc thiết kế khuyên ghép các thành phần nhỏ thay vì xây cây kế thừa sâu là "___ over inheritance".', a: ['composition'], why: 'Go chỉ có embedding (composition) và interface, không có kế thừa.' },
    { t: 'fill', q: 'Điền: trong kiến trúc hexagonal, luồng phụ thuộc đi từ handler → service → ___, và interface của lớp này do service khai báo.', a: ['repository', 'repo'], why: 'Repository tách truy cập dữ liệu khỏi nghiệp vụ; service chỉ biết interface.' },
    { t: 'open', q: 'Thiết kế lớp Rate limiter cho apiserver multi-tenant (giới hạn theo tenant, 100 req/s, burst 200), có thể chạy nhiều instance sau này. Trình bày 4–6 câu: interface, thuật toán, concurrency, mở rộng.', a: 'Khai báo interface Limiter với Allow(key string) bool để handler chỉ phụ thuộc hợp đồng. Implementation đầu tiên là token bucket per tenant: mỗi key một bucket (tokens, last), nạp lười theo thời gian trôi qua khi có request, rate 100, burst 200; bọc mutex (hoặc shard theo hash key nếu contention) và dọn key cũ bằng LRU/TTL để bộ nhớ không phình. Trả 429 kèm Retry-After khi Allow false, có metric số lần từ chối theo tenant. Khi chạy nhiều instance, thêm implementation Redis dùng script Lua nguyên tử với cùng interface, caller không đổi; chấp nhận local limiter là N lần rate trong giai đoạn chuyển tiếp.', keys: ['token bucket', 'interface', 'mutex', 'Redis', '429'] }
  ]
},
{ id: 'K5', type: 'knowledge', topic: 'net', title: 'Networking Q&A', time: '120 phút',
  goal: 'Kể trọn vẹn "what happens when you type a URL" trong 3 phút, giải thích TIME_WAIT/ephemeral port và vì sao phải có connection pool, so sánh HTTP/1.1–2–3, TLS 1.3, L4/L7, và chẩn đoán được lỗi hairpin NAT đã gặp trên pilot.',
  md: `
### Vấn đề cần giải
Networking là phần nhiều kỹ sư backend "biết mang máng" nhất, và người phỏng vấn senior thích xoáy vào đó vì nó lộ ngay độ sâu: bạn hiểu vì sao service gọi API ngoài 500 lần/giây bỗng ECONNRESET (hết ephemeral port), vì sao HTTP/2 vẫn bị head-of-line blocking, vì sao FE trong container gọi hostname public lại ECONNREFUSED (sự cố #10). Bài này đi theo đường đi của một request và dừng ở các điểm hay bị hỏi.

### Phần 1 · Đường đi của một request

#### Q1. What happens when you type a URL and press Enter?
**Trả lời mẫu (3 phút):** (1) Browser parse URL, kiểm tra HSTS để ép HTTPS. (2) **DNS**: cache browser → cache OS → recursive resolver của ISP/1.1.1.1 → nếu miss: root → TLD (.com) → authoritative → trả A/AAAA kèm TTL; resolver cache theo TTL. (3) **TCP 3-way handshake** (SYN, SYN-ACK, ACK) với IP đó, 1 RTT. (4) **TLS 1.3** 1 RTT: ClientHello (phiên bản, cipher, key share, SNI, ALPN) → ServerHello + chứng chỉ + Finished → client kiểm tra chuỗi chứng chỉ, hostname → Finished; ALPN chốt h2 hay http/1.1. (5) Gửi HTTP request; đi qua CDN/L7 LB → app server → DB. (6) Nhận response, parse HTML, tải tài nguyên con (tái dùng kết nối keep-alive/h2 multiplexing), render. Tổng cộng trước byte đầu tiên: DNS ~20–50 ms + TCP 1 RTT + TLS 1 RTT + xử lý server; liên lục địa mỗi RTT ~150 ms nên CDN gần người dùng quan trọng hơn tối ưu server vài ms.
**Câu vặn:** "Lần truy cập thứ hai nhanh hơn ở đâu?" → DNS cache, TLS session resumption (0-RTT), kết nối keep-alive còn mở, HTTP cache (ETag/max-age).

#### Q2. TCP: 3-way, 4-way, TIME_WAIT và ephemeral port exhaustion?
**Trả lời mẫu:** Mở 3 bước; đóng 4 bước (FIN/ACK mỗi chiều). Bên **chủ động đóng** vào TIME_WAIT 2 x MSL (Linux 60 s) để nuốt gói trễ. Mỗi kết nối client cần một ephemeral port (Linux mặc định 32768–60999 ≈ 28k port). Nếu client mở–đóng kết nối mới cho mỗi request tới cùng đích: 28k port / 60 s ≈ **470 kết nối mới/giây** là trần, vượt là "cannot assign requested address". Giải pháp: **connection pool / keep-alive** (một kết nối phục vụ hàng nghìn request), hoặc [[tcp_tw_reuse]]. Go: [[http.Transport.MaxIdleConnsPerHost]] mặc định **2** → gọi API ngoài song song 50 goroutine sẽ liên tục mở–đóng; set 100 và [[IdleConnTimeout]] 90 s. Và luôn [[resp.Body.Close()]] sau khi đọc hết, nếu không kết nối không được trả về pool.

#### Q3. Nagle và delayed ACK; head-of-line blocking?
**Trả lời mẫu:** Nagle gom các gói nhỏ chờ ACK; delayed ACK bên nhận chờ tới 40 ms để gộp ACK; hai thứ gặp nhau trong mẫu write–write–read gây **trễ 40 ms** mỗi request. Go bật [[TCP_NODELAY]] mặc định cho TCPConn, nhiều ngôn ngữ khác không. HOL blocking: HTTP/1.1 một kết nối một request đang bay (pipelining gần như không ai bật) → browser mở 6 kết nối/host; HTTP/2 multiplex nhiều stream trên một TCP nhưng **một gói mất làm mọi stream chờ** (HOL ở tầng TCP); HTTP/3 chạy trên QUIC/UDP, mỗi stream độc lập, nên hết HOL.

#### Q4. HTTP/1.1 vs HTTP/2 vs HTTP/3?
| Tiêu chí | HTTP/1.1 | HTTP/2 | HTTP/3 (QUIC) |
|---|---|---|---|
| Kết nối | 1 request đang bay/kết nối, keep-alive | 1 kết nối, nhiều stream (multiplex) | UDP, stream độc lập |
| Header | text, lặp lại | HPACK nén nhị phân | QPACK |
| HOL blocking | ở tầng ứng dụng | hết ở ứng dụng, còn ở TCP | hết |
| Handshake | TCP + TLS = 2 RTT | 2 RTT | 1 RTT, 0-RTT khi resume |
| Đổi mạng (wifi→4G) | đứt | đứt | connection ID → giữ kết nối |
| Dùng khi | API nội bộ đơn giản, debug dễ | gRPC, browser–CDN | mobile, mạng mất gói |
**Câu vặn:** "Server-to-server trong datacenter nên dùng gì?" → HTTP/2 (gRPC) nếu cần streaming và nhiều call nhỏ; HTTP/1.1 + pool cũng đủ cho đa số; HTTP/3 ít lợi khi RTT 0,5 ms và không mất gói.

#### Q5. TLS 1.3 handshake, chuỗi chứng chỉ, mTLS?
**Trả lời mẫu:** TLS 1.3 còn 1 RTT (1.2 là 2) vì client gửi key share ngay ClientHello; chỉ còn cipher AEAD (AES-GCM, ChaCha20); forward secrecy bắt buộc. Server gửi leaf cert + **intermediate**; client nối tới root trong trust store, kiểm tra chữ ký từng mắt, SAN khớp hostname, thời hạn, thu hồi (OCSP stapling). Quên gửi intermediate là lỗi phổ biến: curl trên máy có cache intermediate thì chạy, Go client thì "unknown authority". **mTLS**: client cũng trình chứng chỉ → xác thực service-to-service (service mesh, SPIFFE); giá: xoay chứng chỉ tự động, debug khó hơn.

#### Q6. DNS: TTL, negative cache, DNS trong Docker?
**Trả lời mẫu:** Resolver cache theo TTL của record; câu trả lời NXDOMAIN cũng được cache theo **negative TTL** (SOA minimum, RFC 2308) → tạo record mới vẫn "không tồn tại" vài phút. Go resolver thuần không cache DNS → mỗi dial là một truy vấn; pool kết nối cũng là cache DNS gián tiếp. Docker: resolver nhúng 127.0.0.11 phân giải tên service trong cùng network; dùng tên service, không dùng IP container (đổi sau recreate).

#### Q7. NAT, hairpin và sự cố #10?
**Trả lời mẫu:** Hairpin NAT là khi máy bên trong gọi **địa chỉ public của chính gateway** mong được quay lại vào trong; nhiều NAT (kể cả Docker bridge mặc định) không hỗ trợ → SYN đi tới IP public của host, không có port mapping ngược → ECONNREFUSED hoặc timeout. Trên pilot, FE Next.js server-side gọi API bằng hostname public (phân giải ra IP public của EC2) → fail 100% dù browser gọi cùng URL thì chạy. Fix: FE server-side gọi tên service nội bộ ([[http://sbom:20000]]) hoặc [[extra_hosts]] trỏ hostname về IP nội bộ; tách **base URL cho server-side** và **base URL cho browser**. Bài học thứ hai: Next.js bake biến [[NEXT_PUBLIC_*]] vào image lúc build → env runtime vô dụng, sửa phải rebuild.

### Phần 2 · Tầng ứng dụng

#### Q8. Load balancer L4 vs L7?
| | L4 (TCP/UDP) | L7 (HTTP) |
|---|---|---|
| Nhìn thấy | IP, port | URL, header, cookie, gRPC method |
| Khả năng | cân bằng theo kết nối, rất nhanh, giữ mTLS end-to-end | route theo path, sticky cookie, TLS termination, WAF, retry, canary theo header |
| Giới hạn | không route theo nội dung; kết nối dài h2 dồn vào 1 backend | tốn CPU, chấm dứt TLS, thêm độ trễ ~ms |
| Ví dụ | AWS NLB, HAProxy tcp mode | ALB, Nginx, Envoy |
**Câu vặn:** "gRPC qua ALB có vấn đề gì?" → gRPC giữ một kết nối HTTP/2 dài, L4 LB cân bằng theo kết nối nên 1 client dồn hết vào 1 backend; cần L7 hiểu h2 (ALB hỗ trợ gRPC) hoặc client-side LB (xDS, DNS round-robin với [[MaxConnectionAge]] phía server).

#### Q9. WebSocket upgrade và gRPC?
**Trả lời mẫu:** WebSocket bắt đầu bằng HTTP GET với [[Upgrade: websocket]], [[Sec-WebSocket-Key]] → server trả 101 rồi hai bên chuyển sang khung nhị phân song công trên cùng TCP. LB/proxy phải hỗ trợ upgrade và idle timeout dài (ALB 60 s mặc định → cần ping). Scale: kết nối stateful nên fan-out qua Redis pub/sub hoặc broker giữa các node. gRPC = protobuf trên HTTP/2: unary và 3 kiểu streaming; status nằm trong **trailer** nên proxy không hỗ trợ trailer làm hỏng; browser cần grpc-web.

#### Q10. CORS là gì, bảo vệ ai?
**Trả lời mẫu:** Cơ chế của **browser**: trang ở origin A gọi API ở origin B thì browser chặn đọc response trừ khi B trả [[Access-Control-Allow-Origin]] khớp. Request "không đơn giản" (method khác GET/POST, header tuỳ chỉnh như [[Authorization]], [[traceparent]], content-type JSON) có **preflight OPTIONS** trước; cache preflight bằng [[Access-Control-Max-Age]]. [[*]] không đi cùng credentials. CORS không bảo vệ server khỏi curl; nó bảo vệ **người dùng** khỏi trang lạ dùng cookie của họ. Hệ SBOM: FE local từng logout ngay sau login vì OTel tự thêm header [[traceparent]] khiến preflight với mock server fail.

#### Q11. Idempotent method và caching semantics?
**Trả lời mẫu:** Safe: GET, HEAD, OPTIONS. Idempotent: safe + PUT, DELETE (gọi N lần = 1 lần). POST và PATCH không → proxy/client không tự retry; muốn retry POST cần header [[Idempotency-Key]] lưu kết quả 24 h. Cache: [[Cache-Control: max-age, s-maxage, no-store, private]]; [[ETag]] + [[If-None-Match]] → 304 tiết kiệm băng thông không tiết kiệm xử lý; [[Vary: Accept-Encoding, Authorization]] để cache không trộn người dùng.

### 10 câu hỏi nhanh
1. Port 443 là của ai? → Server listen; client dùng ephemeral port ngẫu nhiên.
2. SYN flood chống bằng gì? → SYN cookies; không cấp tài nguyên trước khi ACK thứ ba.
3. MTU/MSS? → MTU 1500 byte Ethernet, MSS ≈ 1460; phân mảnh làm chậm, PMTUD.
4. Vì sao UDP cho DNS/QUIC? → Không handshake, không HOL; QUIC tự làm reliability trên UDP.
5. Keep-alive HTTP khác TCP keepalive? → HTTP: tái dùng kết nối; TCP keepalive: gói thăm dò phát hiện peer chết (mặc định sau 2 giờ!).
6. Slow start là gì? → cwnd bắt đầu 10 MSS, nhân đôi mỗi RTT đến khi mất gói; kết nối ngắn không bao giờ đạt băng thông.
7. 502 vs 503 vs 504? → 502 upstream trả rác/đóng; 503 quá tải/không sẵn sàng; 504 upstream timeout.
8. Sticky session có cần không? → Tránh nếu được (state vào Redis); cần cho WebSocket đôi khi.
9. SNI để làm gì? → Hostname trong ClientHello để một IP phục vụ nhiều chứng chỉ; ECH mã hoá nó.
10. Anycast? → Cùng IP quảng bá nhiều nơi, BGP đưa tới nơi gần nhất (DNS root, CDN).

### Sai lầm hay gặp
- Nói "DNS → TCP → HTTP" rồi hết; không nhắc TLS, ALPN, cache, CDN, TTL.
- Nghĩ TIME_WAIT là lỗi cần tắt; thật ra thiếu connection pool mới là lỗi.
- Tin HTTP/2 hết HOL blocking hoàn toàn.
- Cấu hình CORS [[*]] rồi tưởng API an toàn hoặc tưởng CORS chặn được script độc hại từ server.
- Dùng IP container, hostname public, hoặc [[localhost]] trong container để gọi service khác.
- Không [[Body.Close()]] trong Go → leak kết nối, rồi đổ lỗi cho mạng.

### Nói thế nào trong phỏng vấn (EN)
- "Before the first byte we pay DNS, one RTT for TCP and one for TLS 1.3, so on a 150 ms path that's already 300 ms plus." — Trước byte đầu tiên trả DNS, 1 RTT TCP, 1 RTT TLS; đường 150 ms đã mất 300 ms trở lên.
- "Opening a connection per request caps you at a few hundred connections per second because of TIME_WAIT and ephemeral ports, so we pool." — Mở kết nối mỗi request bị trần vài trăm/giây vì TIME_WAIT và ephemeral port nên phải pool.
- "HTTP/2 removes application-level head-of-line blocking, but a lost TCP segment still stalls every stream; QUIC fixes that." — HTTP/2 bỏ HOL ở ứng dụng nhưng gói TCP mất vẫn chặn mọi stream; QUIC sửa điều đó.
- "I'd put an L7 load balancer in front for path routing and TLS termination, and keep gRPC balancing client-side or in Envoy." — Dùng L7 LB cho route theo path và TLS; cân bằng gRPC ở client hoặc Envoy.
- "The server-side rendering was hitting the public hostname from inside Docker, which hairpins through NAT and fails; we switched to the internal service name." — SSR gọi hostname public từ trong Docker bị hairpin NAT; chuyển sang tên service nội bộ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Kiểm tra mọi [[http.Client]] gọi ClearlyDefined/OSV/NVD/GHSA trong apiserver, worker và Lambda: có dùng chung Transport không, [[MaxIdleConnsPerHost]] bao nhiêu (mặc định 2), có [[Timeout]] không, có [[Body.Close()]] không; đo [[ss -s]] trên host xem số TIME_WAIT khi enrichment chạy.
- Sự cố #10: viết thành quy tắc trong runbook: FE server-side dùng [[API_INTERNAL_URL]] (tên service compose), browser dùng [[NEXT_PUBLIC_API_URL]]; thêm smoke test SSR sau deploy gọi API nội bộ; ghi rõ biến [[NEXT_PUBLIC_*]] phải rebuild image.
- Nginx Proxy Manager trước apiserver: xác nhận keep-alive upstream, [[proxy_read_timeout]] cho export dài, HTTP/2 bật phía client; WebSocket/SSE (nếu có notification realtime) cần [[proxy_http_version 1.1]] và Upgrade header.
- Chứng chỉ: kiểm tra server có gửi intermediate không ([[openssl s_client -showcerts]]); Go client của Lambda từng có thể fail "unknown authority" vì thiếu intermediate.
- DNS trong compose: rà cấu hình còn chỗ nào dùng IP container hoặc [[localhost]] (Lambda fallback REDIS_HOST=localhost là sự cố #2) → đổi sang tên service và fail-fast khi env thiếu.
- CORS: liệt kê header FE gửi ([[Authorization]], [[traceparent]], [[x-tenant-id]]) và cấu hình [[Access-Control-Allow-Headers]] + [[Max-Age 600]] để giảm preflight; bài học từ lần FE local logout.
- Thêm vào checklist review API: method đúng ngữ nghĩa idempotent; POST có [[Idempotency-Key]] cho upload SBOM để retry không tạo revision đôi.
- Tự luyện: nói "what happens when you type URL" 3 phút có bấm giờ, ghi âm, nghe lại.
`,
  quiz: [
    { t: 'mc', q: 'Service Go gọi API ngoài 600 request/giây, mỗi request mở kết nối mới rồi đóng. Sau vài phút lỗi "cannot assign requested address". Nguyên nhân chính?', o: ['Server ngoài giới hạn rate', 'Hết ephemeral port vì kết nối đã đóng nằm ở TIME_WAIT 60 s', 'Hết file descriptor của process', 'DNS resolver bị quá tải'], a: 1, why: '~28k ephemeral port / 60 s TIME_WAIT ≈ 470 kết nối mới/giây là trần; dùng connection pool/keep-alive.' },
    { t: 'mc', q: 'HTTP/2 multiplex nhiều stream trên một kết nối TCP. Khi một gói TCP bị mất:', o: ['Chỉ stream chứa gói đó chờ retransmit', 'HPACK tự bù dữ liệu thiếu', 'Browser mở kết nối mới cho các stream khác', 'Mọi stream đều chờ vì TCP giao dữ liệu theo thứ tự (HOL ở tầng transport)'], a: 3, why: 'HTTP/2 chỉ bỏ HOL ở tầng ứng dụng; QUIC trong HTTP/3 mới có stream độc lập.' },
    { t: 'mc', q: 'Browser gửi request OPTIONS trước request POST JSON có header Authorization tới origin khác. Đây là:', o: ['CORS preflight để kiểm tra server cho phép method/header', 'TLS renegotiation', 'HTTP/2 upgrade negotiation', 'Kiểm tra HSTS'], a: 0, why: 'Request không đơn giản (header tuỳ chỉnh, JSON) kích hoạt preflight; cache bằng Access-Control-Max-Age.' },
    { t: 'mc', q: 'FE Next.js chạy trong Docker trên EC2, server-side gọi API bằng hostname public của chính EC2 → ECONNREFUSED, nhưng browser gọi cùng URL thì chạy. Nguyên nhân?', o: ['Chứng chỉ TLS không hợp lệ với Node', 'Node không hỗ trợ HTTP/2', 'Hairpin NAT: gói từ trong container tới IP public của host không được NAT quay ngược vào', 'Security group chặn port từ bên trong'], a: 2, why: 'Docker bridge không hairpin mặc định; sửa bằng tên service nội bộ hoặc extra_hosts.' },
    { t: 'mc', q: 'Method HTTP nào idempotent nhưng không safe?', o: ['GET', 'PUT', 'POST', 'HEAD'], a: 1, why: 'PUT thay đổi trạng thái (không safe) nhưng gọi nhiều lần cho cùng kết quả (idempotent); POST không idempotent.' },
    { t: 'fill', q: 'Điền: bên chủ động đóng kết nối TCP giữ trạng thái ___ trong 2 x MSL (Linux 60 s) để nuốt gói đến trễ.', a: ['time_wait', 'time-wait', 'timewait'], why: 'TIME_WAIT là bình thường; vấn đề chỉ xuất hiện khi mở kết nối mới cho mỗi request.' },
    { t: 'fill', q: 'Điền: phần mở rộng TLS cho phép client và server thoả thuận giao thức tầng ứng dụng (h2 hay http/1.1) ngay trong handshake gọi là ___.', a: ['alpn', 'application-layer protocol negotiation'], why: 'ALPN trong ClientHello/ServerHello tránh tốn thêm RTT để upgrade.' },
    { t: 'open', q: 'Worker Go gọi ClearlyDefined với 50 goroutine song song, metric cho thấy latency p99 tăng và lỗi connection reset lẻ tẻ. Hãy nêu 4–6 điểm bạn sẽ kiểm tra và sửa ở tầng mạng/HTTP client.', a: 'Kiểm tra http.Transport dùng chung hay tạo mới mỗi lần (mỗi Transport một pool riêng → không tái dùng); MaxIdleConnsPerHost mặc định 2 nên 50 goroutine liên tục mở–đóng kết nối, tăng lên 50–100 và IdleConnTimeout 90 s. Xác nhận resp.Body được đọc hết và Close để kết nối trả về pool. Xem số TIME_WAIT bằng ss trên host và ephemeral port usage. Đặt Timeout tổng và context deadline cho mỗi call, giới hạn song song bằng semaphore theo rate limit nhà cung cấp, thêm retry có backoff chỉ cho lỗi mạng/5xx với idempotent GET. Cuối cùng kiểm tra DNS: Go không cache nên pool kết nối cũng là cách giảm truy vấn DNS.', keys: ['MaxIdleConnsPerHost', 'Body.Close', 'TIME_WAIT', 'timeout', 'semaphore'] }
  ]
},
{ id: 'K6', type: 'knowledge', topic: 'os', title: 'Operating system Q&A', time: '120 phút',
  goal: 'Giải thích bằng ngôn ngữ vận hành: RSS vs heap, page cache và "free thấp là bình thường", OOM killer global vs cgroup (vì sao OOMKilled=false), CPU throttling, epoll vs io_uring, fsync/WAL, container = namespace + cgroup + overlayfs, và quy trình SIGTERM → drain.',
  md: `
### Vấn đề cần giải
Người phỏng vấn senior hỏi OS không phải để bạn kể lý thuyết scheduler, mà để xem bạn **đọc được máy đang làm gì** khi service chậm hoặc chết: [[top]] báo free 200 MB có đáng lo không, worker biến mất nhưng [[docker inspect]] nói OOMKilled=false (sự cố #3) là sao, CPU trung bình 30% mà p99 vẫn nhảy là vì đâu. Mỗi câu dưới đây gắn với một tình huống vận hành.

### Phần 1 · Bộ nhớ

#### Q1. Process khác thread thế nào? Tốn gì?
| | Process | Thread | Goroutine (so sánh) |
|---|---|---|---|
| Không gian địa chỉ | riêng | chung trong process | chung |
| Tạo | fork ~100 µs+, copy page table (COW) | ~10–20 µs, stack 8 MB ảo | ~1 µs, stack 2 KB |
| Chuyển ngữ cảnh | nặng nhất (đổi page table, flush TLB) | ~1–5 µs qua kernel | ~200 ns user space |
| Cách ly lỗi | crash một process không ảnh hưởng process khác | một thread panic chết cả process | như thread |
| Giao tiếp | IPC: pipe, socket, shm | biến chung + lock | channel |
**Câu vặn:** "Vì sao Postgres dùng process mỗi kết nối còn Go dùng goroutine?" → Lịch sử + cách ly (một backend crash không kéo theo DB), giá là mỗi kết nối ~5–10 MB và fork chậm → cần PgBouncer khi hàng nghìn client.

#### Q2. Virtual memory, paging, TLB, page fault?
**Trả lời mẫu:** Mỗi process thấy không gian địa chỉ ảo liên tục; MMU dịch qua page table nhiều tầng theo trang 4 KB; **TLB** cache bản dịch (hit ~1 ns, miss vài chục ns và vài lần đọc bộ nhớ). Page fault **minor**: trang chưa map nhưng đã trong RAM (cấp phát lười, COW) ~1 µs; **major**: phải đọc từ đĩa/swap ~ms. Huge page 2 MB giảm TLB miss cho DB lớn (Postgres [[huge_pages=on]]), nhưng Transparent Huge Pages bật mặc định có thể gây stall nên DB thường tắt THP.

#### Q3. Vì sao "free memory" thấp là bình thường? Page cache là gì?
**Trả lời mẫu:** Kernel dùng RAM rảnh làm **page cache** cho file đã đọc/ghi; cột [[free]] thấp, cột [[available]] mới quan trọng (bao gồm cache có thể thu hồi). Postgres dựa vào page cache nhiều hơn shared_buffers (khuyến nghị shared_buffers 25% RAM, phần còn lại để OS cache). Bẫy container: [[memory.current]] của cgroup **tính cả page cache** mà container tạo ra (ghi log, đọc file) → "RAM container tăng dần" không hẳn leak; nhìn [[anon]] trong [[memory.stat]] hoặc RSS của process.

#### Q4. RSS khác heap thế nào với Go?
**Trả lời mẫu:** RSS = tổng trang vật lý đang map: heap + stack goroutine + binary + thư viện + page cache mmap. Go báo [[HeapInuse]] (đang dùng), [[HeapIdle]] (giữ nhưng rảnh), [[Sys]] (xin từ OS). Go trả bộ nhớ cho OS **lười** (scavenger, MADV_DONTNEED) nên RSS thường cao hơn live heap 1,5–2 lần sau đỉnh tải; đó không phải leak nếu HeapInuse không tăng theo thời gian. GOMEMLIMIT tính trên tổng bộ nhớ runtime, không chỉ heap.

#### Q5. OOM killer và cgroup v2 memory.max; vì sao OOMKilled=false? (sự cố #3)
**Trả lời mẫu:** Có **hai** OOM: (1) **cgroup OOM**: container vượt [[memory.max]] → kernel giết process **trong cgroup đó**, Docker ghi [[OOMKilled=true]], exit 137. (2) **global OOM**: host hết RAM → kernel chọn nạn nhân theo [[oom_score]] (≈ RSS + [[oom_score_adj]]) trên **toàn host**, có thể giết Postgres thay vì thủ phạm; Docker chỉ thấy container "exited 137" với OOMKilled=false. Worker SBOM không có [[mem_limit]] phình 5 GiB → global OOM → inspect không thấy gì, phải đọc [[dmesg]] / [[journalctl -k]] dòng "Out of memory: Killed process". Bài học: **mọi container phải có memory limit** để lỗi được cô lập và quan sát được; [[memory.high]] để throttle trước khi giết; đặt [[oom_score_adj]] âm cho DB.
**Câu vặn:** "Limit bao nhiêu?" → Đo RSS p99 lúc tải cao x 1,3; GOMEMLIMIT = 85% limit; alert khi RSS > 80% limit.

#### Q6. Swap trong server và container?
**Trả lời mẫu:** Swap cứu khỏi OOM nhưng biến lỗi rõ ràng thành **chậm mơ hồ** (major fault hàng ms, latency tăng 100 lần); Kubernetes mặc định tắt swap, DB cũng khuyên tắt hoặc swappiness 1. Có swap nhỏ để kernel đẩy trang nguội của process idle là chấp nhận được trên máy đơn.

### Phần 2 · CPU và I/O

#### Q7. CPU scheduling, context switch, CPU throttling?
**Trả lời mẫu:** Linux CFS chia CPU theo vruntime, time slice vài ms; context switch ~1–5 µs cộng mất cache L1/L2 (chi phí thật thường lớn hơn). Trong container, [[cpu.max]] (quota/period 100 ms) là **hạn mức theo chu kỳ**: service được 2 CPU nhưng có 8 thread chạy burst → dùng hết quota trong 25 ms đầu rồi **bị treo 75 ms** còn lại → p99 nhảy dù CPU trung bình 30%. Xem [[nr_throttled]] trong [[cpu.stat]]. Giải pháp: GOMAXPROCS = quota, tăng limit hoặc bỏ limit CPU chỉ giữ request.
**Câu vặn:** "Load average 8 trên máy 4 core nghĩa gì?" → Trung bình 8 task runnable hoặc chờ I/O không ngắt được (D state); phải xem thêm [[%iowait]], [[vmstat r/b]] mới kết luận.

#### Q8. Các mô hình I/O: blocking, non-blocking, multiplexing, async?
| Mô hình | Cách | Chi phí | Ví dụ |
|---|---|---|---|
| Blocking | 1 thread chờ 1 fd | thread mỗi kết nối, context switch | Apache prefork, JDBC |
| Non-blocking + poll loop | thử liên tục | đốt CPU | hiếm |
| Multiplexing: select/poll | truyền danh sách fd mỗi lần, O(n) | n lớn chậm | legacy |
| Multiplexing: epoll/kqueue | kernel giữ interest list, trả fd sẵn sàng O(1) | tốt nhất cho socket | Nginx, Node, Go netpoller |
| Async: io_uring | nộp lệnh vào ring, kernel hoàn thành, không syscall mỗi lần | mới, bề mặt bảo mật | file I/O tốc độ cao, ScyllaDB |
**Trả lời mẫu:** Go cho lập trình viên API blocking ([[conn.Read]]) nhưng runtime chuyển thành epoll + park goroutine → vừa dễ viết vừa scale. File I/O thường trên Linux không có non-blocking thật → Go dùng thread pool cho syscall file.

#### Q9. Zero-copy, sendfile, file descriptor limit?
**Trả lời mẫu:** Đọc file rồi [[write]] ra socket tốn 4 lần copy và 4 lần chuyển ngữ cảnh; [[sendfile]]/[[splice]] chuyển thẳng trong kernel (Go [[io.Copy]] tự dùng khi nguồn là [[*os.File]] và đích là [[*net.TCPConn]]). Mỗi socket, file, pipe là một fd; vượt [[ulimit -n]] → "too many open files" (Go 1.19+ tự nâng soft lên hard limit). Leak fd thường là quên [[Body.Close()]] hoặc mở file trong vòng lặp không đóng; đếm bằng [[ls /proc/PID/fd]].

#### Q10. fsync, WAL, journal: dữ liệu bền từ lúc nào?
**Trả lời mẫu:** [[write()]] chỉ ghi vào page cache; mất điện là mất. [[fsync]] ép xuống thiết bị (SSD ~0,1–1 ms, HDD ~10 ms, EBS gp3 ~1 ms). DB dùng **WAL**: ghi tuần tự log + fsync ở commit (Postgres [[synchronous_commit=on]]), dữ liệu bảng ghi sau khi checkpoint; group commit gộp nhiều tx vào một fsync nên 1 đĩa vẫn đạt hàng nghìn commit/giây. Filesystem journal (ext4) bảo vệ metadata, không bảo vệ nội dung file.

### Phần 3 · Container và tín hiệu

#### Q11. Container thực chất là gì?
**Trả lời mẫu:** Một **process Linux bình thường** được cách ly bằng **namespace** (pid, net, mnt, uts, ipc, user → thấy pid 1 riêng, mạng riêng, mount riêng), giới hạn bằng **cgroup** (cpu, memory, io, pids), và filesystem là **overlayfs** gồm các layer image chỉ đọc + một layer ghi (copy-on-write; ghi log vào container làm layer phình, nên log ra stdout/volume). Không có kernel riêng → image [[mongo:latest]] cần kernel mới chạy trên host kernel cũ là crash (sự cố #13), và [[uname -r]] trong container là kernel host.

#### Q12. Signal và graceful shutdown: SIGTERM → drain?
**Trả lời mẫu:** [[docker stop]] / Watchtower gửi **SIGTERM** cho PID 1 của container, chờ grace period (mặc định **10 s**, [[stop_grace_period]] để đổi) rồi **SIGKILL** (không bắt được). Bẫy PID 1: nếu entrypoint là shell script không [[exec]], SIGTERM đến shell và không chuyển cho app → app bị SIGKILL sau 10 s không kịp drain; dùng [[exec]] hoặc tini. Quy trình drain: ngừng nhận (health check trả 503 để LB rút ra, đóng listener, cancel consumer) → chờ in-flight với deadline < grace period → flush metric/log → đóng DB. Go: [[signal.NotifyContext]]; SIGQUIT in goroutine dump ra stderr để debug treo.
**Câu vặn:** "Grace 10 s nhưng job policy eval chạy 3 phút?" → Hoặc tăng [[stop_grace_period]] cho worker, hoặc thiết kế job checkpoint/idempotent để bị kill giữa chừng không sao, hoặc cả hai.

### 10 câu hỏi nhanh
1. Exit code 137 và 143? → 128 + 9 (SIGKILL, thường OOM hoặc hết grace) và 128 + 15 (SIGTERM).
2. Trạng thái D trong ps? → Uninterruptible sleep, thường chờ I/O đĩa/NFS; nhiều D = đĩa nghẽn.
3. Zombie process? → Đã exit nhưng cha chưa [[wait]]; vô hại trừ khi hàng nghìn (hết pid); PID 1 trong container phải reap.
4. [[nice]] có giúp DB không? → Chỉ chia CPU khi tranh chấp; không giúp I/O; dùng ionice/cgroup io.
5. Copy-on-write là gì? → fork chia sẻ trang, copy khi ghi; Redis BGSAVE dựa vào đó nên RSS tăng tạm.
6. Tại sao Postgres không cấp shared_buffers = 80% RAM? → Double buffering với page cache, và cần RAM cho work_mem x kết nối.
7. mmap vs read? → mmap tránh copy và tiện truy cập ngẫu nhiên nhưng page fault khó kiểm soát; DB hiện đại tránh mmap (bài báo "Are you sure you want to use mmap").
8. /proc/PID/status xem gì? → VmRSS, VmSwap, Threads, FDSize.
9. ulimit nào hay gây sự cố? → nofile (fd), nproc (thread), core.
10. Kernel panic và container? → Mọi container chết cùng host; đó là lý do sự cố mongo:latest kéo cả Bento chết theo.

### Sai lầm hay gặp
- Hoảng vì [[free]] thấp; alert theo free thay vì available hoặc anon RSS.
- Không đặt memory limit cho container "để nó linh hoạt" → global OOM, nạn nhân ngẫu nhiên, không thấy trong inspect.
- Đặt CPU limit chặt rồi ngạc nhiên vì throttling làm p99 tăng dù CPU thấp.
- Entrypoint shell không [[exec]] → app không bao giờ nhận SIGTERM.
- Coi [[write()]] thành công là dữ liệu đã bền.
- Nói "epoll nhanh hơn select" mà không nói vì sao (interest list trong kernel, trả về chỉ fd sẵn sàng).

### Nói thế nào trong phỏng vấn (EN)
- "Low free memory is fine; what matters is available memory and anonymous RSS, since the page cache is reclaimable." — Free thấp không sao; quan trọng là available và anon RSS vì page cache thu hồi được.
- "Without a cgroup memory limit the host-level OOM killer picks a victim by oom_score, and Docker reports OOMKilled=false, so the failure is invisible." — Không có memory limit thì OOM killer toàn host chọn nạn nhân, Docker báo OOMKilled=false, lỗi vô hình.
- "CPU throttling from cpu.max shows up as p99 spikes even when average utilization is low." — Throttling từ cpu.max hiện ra ở p99 dù CPU trung bình thấp.
- "Go gives us blocking APIs on top of epoll, so one thread can serve thousands of connections." — Go cho API blocking trên epoll nên một thread phục vụ hàng nghìn kết nối.
- "On SIGTERM we stop accepting, drain in-flight work within the grace period, then close connections; anything longer must be idempotent." — Nhận SIGTERM thì ngừng nhận, drain trong grace period, rồi đóng kết nối; việc dài hơn phải idempotent.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #3: thêm [[mem_limit]] (ví dụ 3g) + [[GOMEMLIMIT=2560MiB]] cho worker và apiserver trong docker-compose; đặt [[oom_score_adj]] âm cho container postgres/redis trên host canary để chúng không bị chọn làm nạn nhân.
- Viết lệnh kiểm tra vào runbook: [[journalctl -k --since -1h | grep -i "out of memory"]], [[cat /sys/fs/cgroup/.../memory.stat]] (anon vs file), [[docker inspect --format OOMKilled]]; giải thích vì sao OOMKilled=false không có nghĩa là không OOM.
- Kiểm tra entrypoint của image apiserver/worker có [[exec]] hay tini; đo thời gian từ SIGTERM đến exit khi Watchtower recreate; nếu > 10 s thì tăng [[stop_grace_period]] hoặc thu ngắn job.
- Health check sâu + drain: endpoint [[/ready]] trả 503 khi đang shutdown để Nginx Proxy Manager ngừng route trước khi listener đóng.
- Theo dõi [[cpu.stat nr_throttled]] của container apiserver trên pilot (4 vCPU shared); nếu throttle nhiều, bỏ CPU limit chặt và dùng [[cpu_shares]].
- Postgres trên host canary: xác nhận THP tắt, [[shared_buffers]] ~25% RAM, phần còn lại cho page cache; kiểm tra [[fsync=on]], [[synchronous_commit]] theo yêu cầu bền vững.
- Log container ghi ra stdout với [[max-size]] json-file để layer overlayfs và đĩa không phình; sự cố host OOM từng kèm theo đĩa đầy.
- Bài học #13: pin tag image (mongo:8.2.12) và ghi kernel host tối thiểu vào runbook; Watchtower chỉ theo dõi image có tag cụ thể.
`,
  quiz: [
    { t: 'mc', q: 'Worker Go biến mất, docker inspect báo exit code 137 và OOMKilled=false, container không có memory limit. Khả năng cao nhất?', o: ['Bị SIGTERM bởi Watchtower', 'Panic không recover', 'Hết file descriptor', 'Bị OOM killer toàn host (global) giết; Docker chỉ ghi OOMKilled khi vượt cgroup memory.max'], a: 3, why: '137 = SIGKILL; không có limit thì OOM xảy ra ở cấp host, kiểm chứng bằng dmesg/journalctl -k.' },
    { t: 'mc', q: 'free -m hiện free 300 MB, available 12 GB trên máy 16 GB. Kết luận đúng?', o: ['Bình thường: phần lớn RAM là page cache có thể thu hồi', 'Sắp OOM, cần restart service', 'Có memory leak ở ứng dụng', 'Swap đang được dùng nhiều'], a: 0, why: 'Kernel dùng RAM rảnh làm page cache; alert phải dựa trên available hoặc anon RSS.' },
    { t: 'mc', q: 'Service trong container có cpu.max = 2 CPU, CPU trung bình 30%, nhưng p99 latency nhảy từng đợt đều đặn ~100 ms. Nguyên nhân khả dĩ?', o: ['GC của Go', 'Disk I/O chậm', 'CFS throttling: burst dùng hết quota trong chu kỳ 100 ms rồi bị treo phần còn lại', 'DNS timeout'], a: 2, why: 'cpu.max là hạn mức theo chu kỳ; xem nr_throttled trong cpu.stat để xác nhận.' },
    { t: 'mc', q: 'Entrypoint của image là script sh chạy ./app ở dòng cuối (không exec). Khi docker stop:', o: ['App nhận SIGTERM bình thường', 'SIGTERM đến shell (PID 1) và không được chuyển cho app; app bị SIGKILL sau grace period', 'Docker tự gửi SIGTERM cho mọi process con', 'Shell tự chuyển SIGTERM cho process con'], a: 1, why: 'Shell không forward signal cho foreground child; dùng exec hoặc tini làm PID 1.' },
    { t: 'mc', q: 'Postgres gọi fsync ở mỗi commit chủ yếu để:', o: ['Đảm bảo bản ghi WAL đã nằm trên thiết bị bền trước khi báo commit thành công', 'Giải phóng page cache', 'Cập nhật thống kê cho planner', 'Đồng bộ dữ liệu sang replica'], a: 0, why: 'write() chỉ vào page cache; fsync WAL là điều kiện của durability; group commit gộp nhiều tx vào một fsync.' },
    { t: 'fill', q: 'Điền: cơ chế multiplexing I/O trên Linux giữ interest list trong kernel và chỉ trả về các fd sẵn sàng, được Go netpoller và Nginx dùng, là ___.', a: ['epoll'], why: 'epoll O(1) theo số fd sẵn sàng, khác select/poll phải quét toàn bộ danh sách mỗi lần.' },
    { t: 'fill', q: 'Điền: ba cơ chế kernel tạo nên container là namespace, ___ (giới hạn tài nguyên) và overlayfs.', a: ['cgroup', 'cgroups', 'control group'], why: 'cgroup v2 có memory.max, cpu.max, pids.max; memory.max là nơi OOMKilled=true được sinh ra.' },
    { t: 'open', q: 'Host canary 16 GB thỉnh thoảng OOM, sau đó nhiều container khác nhau chết, inspect đều OOMKilled=false. Trình bày 4–6 câu cách bạn chẩn đoán và sửa triệt để.', a: 'Chẩn đoán: đọc journalctl -k quanh thời điểm sự cố để thấy dòng Out of memory và process bị giết kèm RSS; so với docker ps để biết container; lấy memory.stat của cgroup từng container xem anon tăng (leak/dữ liệu lớn) hay file cache. Nguyên nhân cấu trúc là container không có memory limit nên OOM xảy ra ở cấp host và nạn nhân ngẫu nhiên. Sửa: đặt mem_limit cho mọi container theo RSS p99 x 1,3, GOMEMLIMIT 85% limit cho service Go, oom_score_adj âm cho Postgres/Redis, memory.high để throttle sớm; alert khi RSS > 80% limit. Rồi sửa gốc ở worker: query Preload 490k dòng x 10 goroutine đổi sang batch và giới hạn song song.', keys: ['journalctl', 'memory limit', 'GOMEMLIMIT', 'oom_score_adj', 'alert'] }
  ]
},
{ id: 'K7', type: 'knowledge', topic: 'cloud', title: 'Cloud/AWS cho thiết kế', time: '120 phút',
  goal: 'Chọn đúng compute (EC2/ECS/Lambda), queue (SQS/SNS/EventBridge/Kinesis) và DB (Aurora/DynamoDB) cho một bài system design với lý do bằng số (cold start, timeout, giới hạn, chi phí), nói được IAM least privilege, và rút bài học từ sự cố Lambda mất env.',
  md: `
### Vấn đề cần giải
Trong phỏng vấn system design, "dùng AWS" không phải câu trả lời; người ta muốn nghe **vì sao Lambda chứ không phải ECS**, visibility timeout đặt bao nhiêu, NAT gateway tốn gì, IAM role khác policy ở đâu. Hệ SBOM của bạn chạy enrichment bằng Lambda gọi Postgres/Redis/RabbitMQ trên EC2 và từng kẹt hàng giờ vì Lambda **mất biến môi trường** sau redeploy (sự cố #2) — ví dụ hoàn hảo cho câu "config drift".

### Phần 1 · Compute

#### Q1. EC2 vs ECS/Fargate vs Lambda: chọn thế nào?
| Tiêu chí | EC2 | ECS/Fargate (container) | Lambda |
|---|---|---|---|
| Cold start | không (luôn chạy) | task mới ~30–60 s | Go ~100–300 ms; Java/.NET 1–5 s; provisioned concurrency để tránh |
| Timeout tối đa | không | không | **15 phút** (900 s) |
| Scale | ASG theo phút | theo phút, task | ~1 000 concurrency/10 s mỗi function, mặc định 1 000 đồng thời/region |
| Trạng thái | có đĩa, process dài | process dài, ephemeral storage | stateless, /tmp 512 MB–10 GB |
| Chi phí | rẻ nhất khi tải đều (reserved/spot) | theo vCPU-giờ + GB-giờ | theo ms x GB; 0,20 USD / 1 triệu request + ~16,7 µUSD mỗi GB-s |
| Vận hành | patch OS, capacity | không patch OS, vẫn lo image | gần như không |
| Hợp với | DB, broker, tải ổn định 24/7 | API, worker dài, consumer queue | event-driven, burst, job < 15 phút |
**Trả lời mẫu:** Tải đều 24/7 → container trên EC2/Fargate rẻ hơn Lambda 3–10 lần. Tải burst, thưa, theo sự kiện (file upload → parse) → Lambda. Job > 15 phút, cần kết nối dài (consumer RabbitMQ, WebSocket) → container. Lambda nối Postgres phải qua RDS Proxy hoặc pool nhỏ vì mỗi instance Lambda một kết nối.
**Câu vặn:** "Enrichment SBOM chạy Lambda có hợp không?" → Hợp cho batch ngắn theo sự kiện; không hợp khi phải giữ kết nối RabbitMQ publish inline, cần Redis L1 cache ấm, và job có thể vượt 900 s (reconcile lớn) → chia nhỏ hoặc chuyển về worker container.

#### Q2. S3: consistency, presigned URL, lifecycle?
**Trả lời mẫu:** Từ 12/2020 S3 **strong read-after-write** cho mọi thao tác (kể cả overwrite, list). Độ bền 11 số 9, nhưng availability 99,99% → vẫn retry. Presigned URL: server ký URL có hạn (tối đa 7 ngày với IAM user, bằng thời gian session với role) để client **upload/download trực tiếp** không qua server → tiết kiệm băng thông và CPU server; kèm giới hạn content-length và content-type trong policy. Multipart cho file > 100 MB. Lifecycle: chuyển sang IA sau 30 ngày, Glacier sau 90, xoá sau N năm; expire incomplete multipart. Giới hạn 3 500 PUT và 5 500 GET mỗi giây **mỗi prefix** → tránh prefix tuần tự nóng. Event notification → SQS/Lambda cho pipeline xử lý file.

### Phần 2 · Messaging

#### Q3. SQS vs SNS vs EventBridge vs Kinesis?
| | SQS | SNS | EventBridge | Kinesis Data Streams |
|---|---|---|---|---|
| Mô hình | queue, 1 consumer group kéo | pub/sub đẩy fan-out | event bus, lọc theo rule, lịch | log phân vùng, nhiều consumer đọc lại |
| Thứ tự | FIFO theo MessageGroupId; standard không | không | không | theo shard |
| Replay | không | không | archive & replay | có, 24 h–365 ngày |
| Giới hạn | 1 MiB (từ 8/2025; trước 256 KB), FIFO 300 msg/s (3 000 batch), retention 14 ngày | 256 KB | 256 KB | 1 MB/s ghi, 2 MB/s đọc mỗi shard |
| Dùng khi | việc nền, decouple, retry/DLQ | thông báo nhiều đích (SQS + email + Lambda) | tích hợp SaaS/AWS, routing theo nội dung | stream phân tích, ordering theo key, nhiều reader |
**SQS chi tiết:** **visibility timeout** (mặc định 30 s) phải lớn hơn thời gian xử lý, kéo dài bằng [[ChangeMessageVisibility]] (heartbeat) cho job dài; **DLQ** qua redrive policy [[maxReceiveCount]] 3–5; **long polling** [[WaitTimeSeconds=20]] giảm 90% request rỗng và chi phí; standard là at-least-once và có thể lệch thứ tự → consumer idempotent; FIFO dedup theo id trong 5 phút.
**Câu vặn:** "Vì sao không thay RabbitMQ bằng SQS?" → Có thể, nếu không cần routing phức tạp và chấp nhận poll thay vì push; được lợi managed, không còn sự cố publisher không reconnect (#1); mất: exchange/topic routing linh hoạt, độ trễ ms, chạy local không cần AWS.

### Phần 3 · Dữ liệu

#### Q4. RDS/Aurora: endpoint, failover, scale?
**Trả lời mẫu:** Aurora tách compute và storage: storage 6 bản trên 3 AZ, tự tăng 10 GB một lần tới 128 TiB. **Writer endpoint** (1) và **reader endpoint** (DNS round-robin các replica, lag thường 10–20 ms vì chung storage). Failover ~30 s (RDS Multi-AZ thường 60–120 s); ứng dụng phải **không cache DNS** quá lâu và retry; RDS Proxy giữ pool và rút ngắn failover. Serverless v2 scale theo ACU (0,5–128) trong giây, hợp tải thưa/khó đoán; đắt hơn provisioned khi tải đều. Parameter group là nơi đặt [[statement_timeout]] cấp cluster; đặt ở role (sự cố #4) là cấp dưới, dễ bị quên.

#### Q5. DynamoDB: khi nào và thiết kế key?
**Trả lời mẫu:** Key-value/wide-column, độ trễ ~ms một chữ số ổn định ở mọi quy mô, nhưng **chỉ truy vấn theo key**: partition key (cardinality cao, tránh hot partition — mỗi partition ~3 000 RCU/1 000 WCU) + sort key cho range. **GSI**: key khác, eventually consistent, capacity riêng; **LSI**: cùng partition key, sort key khác, phải tạo cùng bảng, 10 GB mỗi partition key. Item ≤ 400 KB. **On-demand** đắt hơn provisioned ~5–7 lần mỗi request nhưng không lo throttle khi tải khó đoán; tải đều dùng provisioned + autoscaling. **DAX** là cache in-memory phía trước (µs, eventually consistent). Hợp: session, profile, cart, idempotency key, counter; không hợp: báo cáo ad-hoc, join nhiều bảng (như SBOM component–vuln–policy).

#### Q6. ElastiCache, API Gateway, WAF?
**Trả lời mẫu:** ElastiCache Redis: cluster mode (shard theo slot), replica + auto failover, [[maxmemory-policy allkeys-lru]] cho cache, [[noeviction]] cho dữ liệu cần giữ (rate limit, lock). API Gateway: HTTP API rẻ hơn REST API ~70%, timeout tích hợp 29 s (giới hạn cứng, nên upload/export dài phải async), throttle mặc định 10 000 RPS/account; authorizer JWT/Lambda/IAM. WAF: managed rule (OWASP, bot), **rate-based rule** chặn IP > N request/5 phút, đặt trước ALB/API Gateway/CloudFront.

### Phần 4 · Bảo mật, mạng, chi phí, vận hành

#### Q7. IAM role vs policy, least privilege?
**Trả lời mẫu:** **Policy** = tài liệu JSON cho phép/từ chối action trên resource (có condition). **Role** = danh tính **tạm thời** mà service/user assume qua STS (credential xoay tự động, không có access key lâu dài). Container/Lambda nhận role (task role, execution role) → không bao giờ nhúng access key vào env/image. Least privilege: action cụ thể ([[s3:GetObject]] chứ không [[s3:*]]), resource ARN cụ thể, condition theo tag/VPC; permission boundary cho team tự tạo role; audit bằng IAM Access Analyzer "last accessed".

#### Q8. VPC, subnet, security group, NAT?
**Trả lời mẫu:** Public subnet có route ra Internet Gateway; private subnet ra ngoài qua **NAT Gateway** (0,045 USD/giờ + 0,045 USD/GB xử lý → 1 TB/tháng ≈ 45 USD + 33 USD giờ). Security group **stateful** (cho inbound thì reply tự ra), NACL stateless theo subnet. Lambda trong VPC cần ENI và NAT để ra Internet; gọi S3/DynamoDB nên qua **VPC endpoint** (gateway endpoint miễn phí) để không trả phí NAT. Hairpin/DNS nội bộ: dùng private hosted zone, không gọi IP public từ trong.

#### Q9. CloudWatch và alert "no success in N minutes"?
**Trả lời mẫu:** Metric chuẩn 1 phút (5 phút cho một số dịch vụ), custom metric 0,30 USD/metric/tháng, log ingest ~0,50 USD/GB → đừng log mọi thứ ở mức debug. Alarm = period x evaluation periods x datapoints to alarm, và quan trọng: **treat missing data** = breaching cho alarm "có việc thành công không" (nếu không, cron im lặng → không có datapoint → alarm không kêu, đúng vết sự cố #1). Metric math [[FILL(m, 0)]] biến thiếu thành 0. Composite alarm giảm ồn.

#### Q10. Chi phí hay bị bỏ qua?
**Trả lời mẫu:** Data transfer **ra Internet** ~0,09 USD/GB; **cross-AZ** 0,01 USD/GB mỗi chiều (replica, broker nhiều AZ cộng dồn); NAT Gateway theo GB; Lambda tính theo ms x GB nên tăng memory đôi khi **rẻ hơn** vì CPU tăng theo và chạy nhanh hơn; S3 request và lifecycle transition có phí; CloudWatch custom metric và log; EBS gp3 rẻ hơn gp2. Luôn hỏi "ai trả phí egress" khi thiết kế export/CDN.

#### Q11. Lambda config drift (sự cố #2) và đóng gói worker có memory limit?
**Trả lời mẫu:** Env của Lambda là một phần **function configuration**; deploy bằng tool khác (console, CLI [[update-function-configuration]] thiếu biến) ghi đè toàn bộ → mất REDIS_HOST/RABBITMQ_* → code fallback localhost → ping fail, publish inline fail, enrichment pending kẹt hàng giờ mà không có lỗi rõ. Bài học: (1) **config là code**: Terraform/SAM là nguồn sự thật, deploy chỉ qua pipeline; (2) secret/config đọc từ SSM Parameter Store/Secrets Manager theo path, không nhúng; (3) **fail-fast**: thiếu biến bắt buộc → function lỗi ngay khi init, có alarm, thay vì fallback localhost im lặng; (4) publish version + alias để rollback; (5) drift detection định kỳ. Về memory: Lambda chọn 128 MB–10 GB (CPU tỉ lệ theo RAM); ECS đặt hard limit → OOM hiện rõ trong stopped reason; container compose dùng [[mem_limit]] + GOMEMLIMIT. Right-size bằng Container Insights hoặc Lambda Power Tuning.

### Sai lầm hay gặp
- Đề xuất Lambda cho consumer queue dài hạn hoặc job có thể vượt 15 phút.
- Visibility timeout nhỏ hơn thời gian xử lý → message bị xử lý đôi và tưởng là bug consumer.
- Dùng SQS standard rồi giả định thứ tự; không có DLQ nên poison message quay vòng mãi.
- Access key trong env/image thay vì role.
- Alarm thiếu "treat missing data" → hệ thống chết im lặng không ai biết.
- Quên phí NAT/cross-AZ/egress khi ước lượng chi phí.
- Hard-code fallback [[localhost]] thay vì fail-fast khi config thiếu.

### Nói thế nào trong phỏng vấn (EN)
- "The upload path is bursty and short-lived, so Lambda fits; the long-running consumer stays in a container because of the 15-minute limit." — Upload burst và ngắn nên Lambda hợp; consumer dài ở container vì giới hạn 15 phút.
- "I'd set the SQS visibility timeout above the p99 processing time and send it to a DLQ after three receives." — Visibility timeout lớn hơn p99 xử lý, DLQ sau 3 lần nhận.
- "Services assume IAM roles with temporary credentials; there are no long-lived keys in the environment." — Service assume role với credential tạm; không có key lâu dài trong env.
- "The alarm treats missing data as breaching, because a silent cron produces no datapoints at all." — Alarm coi thiếu dữ liệu là vi phạm vì cron im lặng không sinh datapoint.
- "Configuration lives in Terraform and Parameter Store; the function fails fast at init if a required variable is missing." — Config nằm ở Terraform và Parameter Store; thiếu biến thì fail ngay lúc init.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #2: thêm hàm [[mustEnv]] cho REDIS_HOST, RABBITMQ_URL, DB_DSN ở init của Lambda → thiếu là panic ngay, CloudWatch alarm trên Errors; bỏ mọi fallback localhost. Đưa env Lambda vào Terraform/SAM, cấm sửa tay trên console.
- Alarm "no success": metric [[enrichment_success_total]] từ Lambda, alarm nếu SUM 30 phút = 0 với treat missing data = breaching; cùng pattern cho scheduled scan (sự cố #9) và publisher (sự cố #1).
- Đánh giá lại ranh giới Lambda: việc nào cần RabbitMQ publish inline hoặc Redis L1 ấm thì chuyển về worker container; Lambda chỉ nhận batch id, ghi kết quả vào DB, không giữ kết nối dài.
- Lambda nối Aurora: dùng RDS Proxy hoặc pool tối đa 2–3 kết nối mỗi instance; đặt [[statement_timeout]] đúng cấp (parameter group hoặc role riêng cho Lambda), xem K3.
- Chi phí: tính NAT GB cho Lambda gọi ClearlyDefined/OSV ra Internet mỗi tháng; nếu lớn, cân nhắc chạy enrichment trong worker trên EC2 có IP public hoặc gom batch lớn hơn.
- Upload SBOM: presigned URL để FE đẩy thẳng lên S3/MinIO, S3 event → queue → parse; apiserver không còn giữ file trong RAM.
- Nếu đề xuất thay RabbitMQ bằng SQS: viết ADR so sánh (routing, latency, local dev, sự cố #1), nêu rõ visibility timeout và DLQ cho từng loại message.
- Rà IAM: Lambda và EC2 dùng role gì, policy có [[*]] không; bật Access Analyzer last-accessed để thu hẹp.
`,
  quiz: [
    { t: 'mc', q: 'Consumer xử lý mỗi message trung bình 45 s, SQS visibility timeout để mặc định 30 s. Hiện tượng?', o: ['Message bị xoá trước khi xử lý xong', 'SQS tự tăng visibility timeout theo thời gian xử lý', 'Message hiện lại cho consumer khác sau 30 s và bị xử lý đôi', 'Consumer bị throttle'], a: 2, why: 'Visibility timeout phải lớn hơn p99 xử lý hoặc heartbeat bằng ChangeMessageVisibility; consumer còn phải idempotent.' },
    { t: 'mc', q: 'Job reconcile policy cho tenant lớn có thể chạy 25 phút và giữ kết nối RabbitMQ để publish. Compute phù hợp nhất?', o: ['Container worker (ECS hoặc EC2) vì Lambda giới hạn 15 phút và không hợp kết nối dài', 'Lambda với provisioned concurrency', 'Lambda chia thành 2 lần gọi 13 phút', 'API Gateway + Lambda'], a: 0, why: 'Lambda tối đa 900 s và stateless; job dài cần kết nối broker nên ở container.' },
    { t: 'mc', q: 'Alarm CloudWatch theo metric số job thành công mỗi 5 phút, ngưỡng < 1. Cron chết hẳn, không gửi metric nào. Alarm không kêu. Vì sao?', o: ['Alarm chỉ hỗ trợ ngưỡng lớn hơn', 'Treat missing data mặc định là missing (không đánh giá), cần đặt breaching hoặc FILL(m, 0)', 'Metric 5 phút cần evaluation period 15 phút', 'Cần composite alarm'], a: 1, why: 'Không có datapoint thì alarm mặc định giữ trạng thái; hệ thống chết im lặng là đúng kiểu sự cố publisher stale.' },
    { t: 'mc', q: 'Khác biệt cốt lõi giữa IAM role và IAM policy?', o: ['Role dùng cho người, policy dùng cho service', 'Role là tập quyền, policy là danh tính', 'Không khác, hai tên cho một thứ', 'Policy là tài liệu quyền; role là danh tính tạm thời được assume và gắn policy, cấp credential xoay tự động'], a: 3, why: 'Service nhận role (task role, Lambda execution role) nên không cần access key lâu dài.' },
    { t: 'mc', q: 'Lambda trong private subnet gọi S3 rất nhiều, hoá đơn NAT Gateway tăng mạnh. Cách giảm chi phí đúng?', o: ['Chuyển Lambda sang public subnet', 'Tăng memory Lambda để chạy nhanh hơn', 'Tạo S3 gateway VPC endpoint để traffic không đi qua NAT', 'Bật S3 Transfer Acceleration'], a: 2, why: 'Gateway endpoint cho S3/DynamoDB miễn phí và giữ traffic trong mạng AWS; Lambda không có IP public dù ở public subnet.' },
    { t: 'fill', q: 'Điền: trong SQS, khoảng thời gian message bị ẩn khỏi consumer khác sau khi được nhận gọi là ___ timeout.', a: ['visibility', 'visibility timeout'], why: 'Mặc định 30 s; kéo dài bằng ChangeMessageVisibility cho job dài; quá nhỏ gây xử lý đôi.' },
    { t: 'fill', q: 'Điền: URL S3 được server ký với thời hạn để client upload/download trực tiếp không qua server gọi là ___ URL.', a: ['presigned', 'pre-signed', 'presigned url'], why: 'Presigned URL giảm băng thông và CPU server; giới hạn content-length/type trong policy.' },
    { t: 'open', q: 'Sau một lần redeploy, Lambda enrichment mất biến REDIS_HOST và RABBITMQ_URL, code fallback localhost, hàng nghìn dòng pending kẹt 6 giờ mà không có alarm. Đề xuất 4–6 thay đổi để việc này không lặp lại.', a: 'Config là code: khai báo env Lambda trong Terraform/SAM, deploy chỉ qua pipeline, khoá sửa tay trên console và bật drift detection. Đọc config từ SSM Parameter Store/Secrets Manager theo path thay vì nhúng từng biến. Fail-fast: thiếu biến bắt buộc thì panic ở init, không fallback localhost, để Errors tăng và alarm kêu ngay. Alarm "no success in 30 minutes" trên metric enrichment_success với treat missing data = breaching. Publish version + alias để rollback trong một lệnh. Smoke test sau deploy: invoke thử một batch nhỏ và kiểm tra dòng chuyển trạng thái.', keys: ['Terraform', 'fail-fast', 'Parameter Store', 'alarm', 'rollback'] }
  ]
},
{ id: 'K8', type: 'knowledge', topic: 'observability', title: 'Testing & chất lượng trong hệ phân tán', time: '120 phút',
  goal: 'Lập chiến lược test cho một service Go có DB/queue/API ngoài: table-driven unit, integration bằng testcontainers, contract test, test idempotency/retry/trùng thứ tự, load test k6 với threshold, soak test tìm leak, chaos test cho reconnect; và nói về testing một cách thuyết phục trong phỏng vấn system design.',
  md: `
### Vấn đề cần giải
Mọi sự cố ở §1 của hệ SBOM đều **có thể viết thành một bài test**: publisher không reconnect khi broker restart (#1), worker ăn 5 GiB khi project có 490k vulnerability (#3), FetchBatch nuốt lỗi (#7), audit log publish trước commit (#12). Không ai viết vì "test tích hợp khó". Người phỏng vấn senior hỏi về testing không phải để nghe "unit test 80%", mà để biết bạn **test cái gì ở ranh giới hệ thống**: retry, trùng message, mất kết nối, tải kéo dài.

### Phần 1 · Kim tự tháp và từng tầng

#### Q1. Test pyramid cho service backend trông thế nào?
| Tầng | Phạm vi | Tốc độ | Tỉ lệ gợi ý | Ví dụ SBOM |
|---|---|---|---|---|
| Unit | một hàm/struct, fake dependency | ms, hàng nghìn/giây | ~70% | parser license expression, tính risk score |
| Integration | service + Postgres/Redis/RabbitMQ thật trong container | 100 ms–vài s | ~20% | repository query, consumer nhận message |
| Contract | hợp đồng giữa 2 service/FE–BE | nhanh, chạy riêng mỗi bên | vài chục | API response shape cho Next.js FE |
| E2E | cả hệ qua UI/API public | phút, flaky | ~5%, 10–30 kịch bản | upload SBOM → thấy vulnerability |
| Load/soak/chaos | phi chức năng | giờ | theo release | reconcile 90k component không OOM |
**Câu vặn:** "Vì sao không e2e hết cho chắc?" → Chậm, flaky, không chỉ ra lỗi ở đâu, chi phí bảo trì cao; e2e chỉ giữ cho luồng kiếm tiền.

#### Q2. Unit test table-driven trong Go?
~~~go
func TestSplitDeclaredLicense(t *testing.T) {
    cases := []struct{ name, in string; want []string; wantErr bool }{
        {"simple", "MIT", []string{"MIT"}, false},
        {"with exception", "GPL-2.0 WITH Classpath-exception-2.0", []string{"GPL-2.0"}, false},
        {"noassertion", "NOASSERTION", nil, false},
        {"invalid", "MIT AND", nil, true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            got, err := SplitDeclaredLicense(tc.in)
            if (err != nil) != tc.wantErr { t.Fatalf("err = %v, wantErr %v", err, tc.wantErr) }
            if diff := cmp.Diff(tc.want, got); diff != "" { t.Errorf("mismatch (-want +got):\\n%s", diff) }
        })
    }
}
~~~
**Trả lời mẫu:** Mỗi dòng bảng là một case có tên; [[t.Run]] chạy riêng, [[t.Parallel]] khi không chia sẻ state; [[cmp.Diff]] cho thông báo đọc được. Thêm case **từ bug thật** (panic index-out-of-range của spdx expression là một dòng bảng) để regression không quay lại. Fuzz ([[go test -fuzz]]) cho parser nhận input ngoài.

#### Q3. Integration test với testcontainers: vì sao không mock DB?
~~~go
pg, _ := postgres.Run(ctx, "postgres:16-alpine", postgres.WithDatabase("sbom"),
    testcontainers.WithWaitStrategy(wait.ForLog("ready to accept connections").WithOccurrence(2)))
dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
db := mustMigrate(t, dsn) // chạy migration thật
~~~
**Trả lời mẫu:** Mock SQL (sqlmock) kiểm tra bạn **gọi đúng chuỗi SQL**, không kiểm tra SQL **đúng**; lỗi partial index không khớp, FK, ON CONFLICT, deadlock chỉ lộ với Postgres thật. testcontainers khởi động container trong test (Postgres ~2 s, Redis < 1 s, RabbitMQ ~5 s), dùng chung cho cả package qua [[TestMain]], mỗi test một schema hoặc transaction rollback để chạy song song. CI cần Docker socket. Giữ bộ integration dưới 2–3 phút.

#### Q4. Contract test (Pact) dùng khi nào?
**Trả lời mẫu:** Khi hai bên **deploy độc lập**: FE Next.js và apiserver, hoặc apiserver và Lambda enrichment. Consumer viết kỳ vọng (request → response shape) thành pact file; provider chạy pact đó với mock dữ liệu của mình; Pact Broker + [[can-i-deploy]] chặn deploy khi phá hợp đồng. Giải quyết: không cần dựng cả hệ để biết đổi field [[license_ids]] có làm FE vỡ. Không dùng khi cả hai cùng repo và deploy cùng lúc — test tích hợp thẳng rẻ hơn.

### Phần 2 · Test những thứ chỉ hệ phân tán mới có

#### Q5. Test idempotency và retry thế nào?
**Trả lời mẫu:** Ba bài test bắt buộc cho mỗi handler ghi: (1) gọi **hai lần tuần tự** cùng idempotency key/message id → một side effect, cùng response; (2) gọi **đồng thời** 10 lần cùng key ([[errgroup]]) → một dòng trong DB, không lỗi 500; (3) lần đầu **fail giữa chừng** (inject lỗi sau khi ghi DB, trước khi ack) → retry hoàn tất mà không nhân đôi. Dùng fake clock và fault injection qua interface (decorator trả lỗi theo đếm).

#### Q6. Test consumer với message trùng, lệch thứ tự, poison?
**Trả lời mẫu:** Publish cùng message 2 lần (redelivery) → kết quả như 1 lần; publish [[created]] sau [[updated]] → trạng thái cuối theo version/timestamp, không theo thứ tự đến; message hỏng (JSON sai, type rỗng như policy gây panic) → **không crash**, đi DLQ sau N lần, metric tăng; message publish trước khi dữ liệu commit (sự cố #12) → consumer gặp FK → phải retry có backoff thay vì drop. Chạy với RabbitMQ thật trong testcontainers để prefetch, ack/nack đúng semantics.

#### Q7. Load test với k6: đo gì, ngưỡng gì?
~~~js
export const options = {
  scenarios: { steady: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '10m', preAllocatedVUs: 50 } },
  thresholds: { http_req_duration: ['p(95)<300', 'p(99)<800'], http_req_failed: ['rate<0.01'] },
};
~~~
**Trả lời mẫu:** Dùng **open model** (arrival rate cố định) thay vì VU cố định, vì VU chờ response làm tải tự giảm khi server chậm (coordinated omission) → che giấu vấn đề. Đo RPS đạt được, p95/p99, error rate, và **tài nguyên server** (CPU, RSS, kết nối DB, queue depth) song song. Ngưỡng ghi vào script để CI fail. Tăng dần (ramp) để tìm điểm gãy: throughput phẳng mà latency tăng dựng đứng = bão hoà.

#### Q8. Soak test tìm leak (sự cố #3)?
**Trả lời mẫu:** Chạy tải ổn định 50–70% công suất trong 4–24 giờ; vẽ RSS, [[go_goroutines]], số fd, kết nối DB theo thời gian: đường **dốc lên đều** là leak (goroutine chờ channel, Body chưa Close, cache không cap); đường **răng cưa ổn định** là GC bình thường. Chụp heap profile đầu/cuối và so bằng [[pprof -base]]. Worker OOM 5 GiB không phải leak mà là **đỉnh** do dữ liệu lớn → cần test với dataset cỡ production (project 90k component) chứ không phải dữ liệu mẫu 100 dòng.

#### Q9. Chaos test: kill broker, publisher có reconnect không? (sự cố #1)
**Trả lời mẫu:** Kịch bản tối thiểu cho mỗi dependency: (1) [[docker restart rabbitmq]] giữa lúc publish → sau 30 s publish thành công lại, có log reconnect, metric gap được alert; (2) chặn mạng tới Postgres 60 s bằng Toxiproxy → request lỗi nhanh với timeout, không treo pool; (3) thêm latency 2 s cho API ClearlyDefined → circuit breaker mở, enrichment đánh dấu retry chứ không failed vĩnh viễn (sự cố #7); (4) kill worker giữa job → job được lấy lại sau lease, không mất, không nhân đôi. Chạy trong staging theo lịch "game day" mỗi quý; sự cố #1 im lặng nhiều ngày vì chưa ai từng tắt broker trong môi trường test.

#### Q10. Canary analysis là gì?
**Trả lời mẫu:** Deploy phiên bản mới cho một phần nhỏ (1 instance, 5% traffic hoặc môi trường Canary riêng), so **cùng cửa sổ thời gian** error rate, p99, CPU, RSS giữa canary và baseline; vượt ngưỡng thì rollback tự động (Argo Rollouts, Kayenta). Canary của SBOM hiện là môi trường riêng có dữ liệu stress test → tốt để bắt hồi quy hiệu năng nếu có dashboard so sánh với bản trước, chứ không chỉ "chạy thử không lỗi".

### Phần 3 · Chất lượng bộ test và cách nói trong phỏng vấn

#### Q11. Flaky test: nguyên nhân và xử lý?
**Trả lời mẫu:** Nguyên nhân: phụ thuộc thời gian thật ([[time.Sleep]], [[time.Now]]), thứ tự test, state chia sẻ (DB chung, biến global), port cố định, mạng ngoài. Trị: fake clock, [[go test -shuffle=on -count=5 -race]], cô lập dữ liệu mỗi test, chờ theo điều kiện ([[Eventually]]) thay vì sleep, quarantine test flaky có ticket và hạn xoá; không retry mù trên CI.

#### Q12. Coverage bao nhiêu là đủ?
**Trả lời mẫu:** Line coverage đo **code được chạy**, không đo **assert đúng**; 100% vẫn có thể không bắt được bug. Mục tiêu thực tế 70–80% cho package nghiệp vụ, 90%+ cho parser/tính toán tiền và license, bỏ qua generated code. Bổ sung bằng mutation testing cho phần lõi. Theo dõi **coverage không giảm** theo PR hữu ích hơn một con số tuyệt đối.

#### Q13. Nói về testing trong phỏng vấn system design?
**Trả lời mẫu:** Nhắc ở ba điểm: khi vẽ queue ("consumer idempotent, và tôi test bằng cách gửi trùng"), khi nói retry/timeout ("có chaos test tắt broker"), khi nói capacity ("load test open-model đến điểm gãy, soak 8 giờ theo dõi RSS"). Một câu về canary + rollback tự động kết thúc mạnh.

### Sai lầm hay gặp
- Mock DB rồi tin SQL đúng; test chạy xanh nhưng partial index chưa từng được dùng.
- Load test bằng VU cố định → coordinated omission che p99.
- Không test với dữ liệu cỡ production; OOM chỉ lộ trên prod.
- Chưa từng tắt dependency trong môi trường test; reconnect là "chắc thư viện lo".
- Retry mù test flaky trên CI; test phụ thuộc [[time.Sleep]].
- Đọc coverage như KPI; không có test nào cho idempotency dù có retry khắp nơi.

### Nói thế nào trong phỏng vấn (EN)
- "Every consumer is idempotent, and we prove it with a test that delivers the same message twice, including concurrently." — Mọi consumer idempotent và được chứng minh bằng test gửi trùng, kể cả đồng thời.
- "Integration tests run against real Postgres and RabbitMQ in testcontainers; mocks can't tell me whether the index is used." — Integration test chạy Postgres và RabbitMQ thật; mock không cho biết index có được dùng.
- "For load tests I use an open model with a fixed arrival rate, otherwise slow responses hide the real p99." — Load test dùng open model với arrival rate cố định, nếu không p99 bị che.
- "We run a game day where we restart the broker and verify publishers reconnect and the gap alert fires." — Game day restart broker và kiểm tra publisher reconnect, alert gap kêu.
- "Coverage tells me what ran, not what was asserted, so I target the parsing and money paths at 90% and the rest at 75%." — Coverage nói cái gì đã chạy, không nói assert gì; parser và tiền 90%, còn lại 75%.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Viết integration test với testcontainers cho publisher RabbitMQ: publish → [[docker restart]] container broker qua API testcontainers → publish lại trong 30 s phải thành công; đây là test "lẽ ra đã có" của sự cố #1.
- Test FetchBatch (sự cố #7): batch 10 coordinate có 1 phần tử trả lỗi → 9 thành công, 1 đánh dấu retry với lý do; thêm case API trả 429 → không đánh dấu failed.
- Consumer audit log (sự cố #12): test publish trước commit → consumer gặp FK → retry có backoff thành công; test message trùng → một dòng audit.
- Parser policy: thêm case condition có [[type == ""]] vào bảng test, khẳng định trả lỗi thay vì nil,nil; fuzz parser license expression.
- Soak test worker trên Canary: dataset project 90k component thật, chạy reconcile 4 giờ, ghi RSS/goroutine mỗi phút; đặt ngưỡng RSS < 2,5 GB vào tiêu chí release.
- Load test k6 cho 5 endpoint chậm nhất (Components, EOL, VulnAudit, Export, Policy Audit) với arrival rate theo pilot, threshold p95 < 5 s theo SLA; chạy mỗi release trên Canary và so với bản trước.
- CI: [[go test -race -shuffle=on ./...]] cho unit; integration chạy riêng với Docker, dưới 3 phút; coverage không giảm theo PR.
- Game day mỗi quý: tắt RabbitMQ 2 phút, cắt mạng Redis, thêm 2 s latency cho ClearlyDefined qua Toxiproxy; ghi kết quả vào postmortem-style doc.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao integration test repository nên dùng Postgres thật (testcontainers) thay vì sqlmock?', o: ['sqlmock không hỗ trợ transaction', 'Chỉ Postgres thật mới kiểm tra được SQL đúng ngữ nghĩa: index, FK, ON CONFLICT, deadlock', 'testcontainers nhanh hơn sqlmock', 'sqlmock không chạy được trên CI'], a: 1, why: 'Mock chỉ kiểm tra chuỗi SQL được gọi; tính đúng của SQL cần engine thật.' },
    { t: 'mc', q: 'Load test với 50 VU cố định cho thấy p99 = 200 ms. Khi server chậm đi, tải thực tế thế nào và hệ quả?', o: ['Tải tăng vì VU gửi dồn', 'Không đổi, VU là arrival rate', 'Tải tự giảm vì VU chờ response → p99 bị che (coordinated omission)', 'k6 tự chuyển sang open model'], a: 2, why: 'Closed model phụ thuộc response; dùng constant-arrival-rate để mô phỏng người dùng thật đến bất kể server nhanh hay chậm.' },
    { t: 'mc', q: 'Bộ ba test tối thiểu cho idempotency của một handler ghi là:', o: ['Gọi hai lần tuần tự, gọi đồng thời N lần cùng key, lần đầu fail giữa chừng rồi retry', 'Unit, integration, e2e', 'Gọi với key rỗng, key dài, key unicode', 'Gọi trước và sau khi restart DB'], a: 0, why: 'Ba kịch bản bao phủ redelivery, race giữa các retry và partial failure.' },
    { t: 'mc', q: 'Soak test 8 giờ cho thấy RSS tăng đều từ 400 MB lên 2,1 GB, go_goroutines tăng từ 50 lên 12 000. Chẩn đoán hợp lý nhất?', o: ['GC của Go hoạt động bình thường', 'Dữ liệu đầu vào tăng', 'CPU throttling', 'Goroutine leak (goroutine chờ channel/lock không bao giờ được giải phóng)'], a: 3, why: 'Goroutine tăng tuyến tính không hồi là leak; xem goroutine profile để thấy dòng code đang kẹt.' },
    { t: 'mc', q: 'Contract test (Pact) mang lại giá trị cao nhất khi:', o: ['Hai module trong cùng binary', 'Hai bên deploy độc lập (FE và API, API và Lambda) và cần biết thay đổi response có phá bên kia không', 'Cần đo hiệu năng API', 'Thay thế hoàn toàn integration test với DB'], a: 1, why: 'Pact kiểm tra hợp đồng giữa consumer và provider mà không cần dựng cả hệ; can-i-deploy chặn deploy phá hợp đồng.' },
    { t: 'fill', q: 'Điền: thư viện cho phép test Go tự khởi động Postgres/Redis/RabbitMQ thật trong Docker trong lúc chạy test gọi là ___.', a: ['testcontainers', 'testcontainers-go'], why: 'Postgres khởi động ~2 s; dùng chung qua TestMain, mỗi test một schema để chạy song song.' },
    { t: 'fill', q: 'Điền: loại test chạy tải ổn định trong nhiều giờ để tìm memory/goroutine leak gọi là ___ test.', a: ['soak', 'soak test', 'endurance'], why: 'Soak tìm đường dốc lên đều của RSS/goroutine; khác load test đo điểm gãy.' },
    { t: 'open', q: 'Publisher RabbitMQ từng không reconnect sau khi broker bị recreate, làm cron im lặng nhiều ngày. Hãy mô tả 4–6 câu bộ test và tín hiệu bạn thêm để lỗi này không tái diễn.', a: 'Integration test với testcontainers: dựng RabbitMQ thật, publish thành công, restart container broker qua API, khẳng định publish lại thành công trong 30 s và có log reconnect; thêm case restart hai lần liên tiếp và case publish đồng thời từ 20 goroutine trong lúc reconnect (chạy -race). Chaos game day trên staging: docker restart rabbitmq và kiểm tra queue nhận message. Tín hiệu: metric publish_success_total và publish_error_total theo publisher, alarm "no success in 15 minutes" với treat missing data = breaching, health check sâu kiểm tra channel còn mở. Ghi vào checklist release: mọi client giữ kết nối dài phải có test restart dependency.', keys: ['testcontainers', 'restart', 'reconnect', 'alert', 'health check'] }
  ]
},
{ id: 'K9', type: 'knowledge', topic: 'behavioral', title: 'Behavioral & STAR cho kỹ sư backend', time: '120 phút',
  goal: 'Có sẵn 6 câu chuyện STAR(R) 90 giây từ sự cố thật, mỗi câu chuyện có số liệu và bài học, map được vào 8 câu hỏi behavioral hay gặp, tránh 5 red flag, và chuẩn bị 8 câu hỏi ngược cho interviewer.',
  md: `
### Vấn đề cần giải
Vòng behavioral quyết định **level và offer** nhiều hơn người ta tưởng: hai ứng viên kỹ thuật ngang nhau, người kể được "tôi đã làm gì, đo được gì, học được gì" bằng số liệu sẽ được xếp senior. Kỹ sư backend thường kể lan man về hệ thống mà quên vai trò cá nhân, hoặc không có con số. Bạn có lợi thế: 16 sự cố thật ở hệ SBOM là kho chuyện; việc cần làm là **gọt** chúng thành STAR(R) 90 giây.

### Phần 1 · Cấu trúc

#### Q1. STAR(R) là gì và chia thời gian thế nào?
| Phần | Nội dung | Thời lượng | Lỗi hay gặp |
|---|---|---|---|
| Situation | bối cảnh 1–2 câu, có quy mô (tenant, dòng, người dùng) | 15 s | kể lịch sử công ty 2 phút |
| Task | **tôi** chịu trách nhiệm gì, vì sao khó | 10 s | nói "team được giao" |
| Action | 3–4 bước tôi làm, quyết định và lý do, ai tôi kéo vào | 45 s | liệt kê việc của người khác |
| Result | số trước/sau, thời gian, tác động kinh doanh | 15 s | "mọi thứ ổn" không số |
| Reflection | bài học, tôi sẽ làm khác gì, đã lan toả gì (runbook, test, ADR) | 10 s | bỏ qua, hoặc đổ lỗi |
**Trả lời mẫu:** Mở bằng một câu tóm tắt ("Tôi muốn kể lần tôi tìm ra vì sao worker bị OOM 5 GiB mà Docker báo không OOM"), rồi đi STAR, kết bằng bài học. Chuẩn bị mỗi chuyện 2 phiên bản: 90 giây và 3 phút (khi được hỏi sâu).
**Câu vặn:** "Nếu không nhớ số chính xác thì sao?" → Nói khoảng và nguồn ("khoảng 5 GiB theo dmesg", "hàng nghìn dòng theo query lúc đó"); tuyệt đối không bịa số tròn đẹp — interviewer sẽ hỏi cách bạn đo.

### Phần 2 · 6 câu chuyện mẫu (điền số đo thật của bạn vào chỗ ngoặc vuông)

#### Chuyện 1 · Worker OOM "vô hình" (sự cố #3) — dùng cho: debugging, ownership, mentoring
- **S:** Worker Go chạy policy evaluation trên môi trường canary biến mất định kỳ; [[docker inspect]] báo exit 137 nhưng OOMKilled=false, nên team nghĩ là lỗi khác và restart cho qua.
- **T:** Tôi nhận trách nhiệm tìm nguyên nhân gốc thay vì tăng RAM máy.
- **A:** Đọc [[journalctl -k]] thấy kernel global OOM giết process ~5,2 GiB sau 17 phút chạy; dùng pprof heap thấy 1 query Preload toàn bộ vulnerability của project 90k component (490k dòng) được chạy song song 10 goroutine; chứng minh bằng cách tái hiện trên dataset đó. Đề xuất 3 lớp sửa: query theo batch, giới hạn song song 3, và mem_limit + GOMEMLIMIT để OOM lần sau "hiện hình".
- **R:** Worker không còn OOM sau [số ngày] theo dõi, RSS đỉnh còn [X GB]; lỗi nếu xảy ra giờ có OOMKilled=true và alert.
- **Bài học:** "Không thấy lỗi" khác "không có lỗi"; mọi container phải có memory limit. Tôi viết runbook kiểm tra OOM và hướng dẫn hai bạn junior dùng pprof.

#### Chuyện 2 · Publisher im lặng nhiều ngày (sự cố #1) — dùng cho: failure, ownership, process improvement
- **S:** Sau khi Watchtower recreate container RabbitMQ, publisher AMQP singleton trong apiserver không reconnect; mọi cron (scan, sync vulnerability) im lặng nhiều ngày, Last Scanned đứng yên, không alert nào kêu.
- **T:** Tôi được giao điều tra vì sao dữ liệu không cập nhật dù job "vẫn chạy".
- **A:** Dựng lại timeline từ [[t_vulnerabilities.updated_at]] để xác định ngày dừng khớp với log recreate broker; đọc code publisher thấy kết nối được tạo một lần, lỗi publish bị log ở mức debug; viết test integration restart broker để tái hiện. Sửa reconnect có backoff, đưa publish lỗi lên metric, và đề xuất alert "no success in N minutes" với treat-missing-data = breaching.
- **R:** Phát hiện-đến-khắc phục giảm từ "nhiều ngày" xuống [N phút] theo thiết kế alert; test restart broker vào CI.
- **Bài học:** Thiếu alert cho **sự vắng mặt** của thành công là lỗi thiết kế, không phải lỗi vận hành; tôi đã sai khi tin thư viện tự reconnect.

#### Chuyện 3 · Hàng đợi enrichment kẹt vì zombie (sự cố #7, #8, #16) — dùng cho: tight deadline, prioritization
- **S:** Trước release, 696k dòng license enrichment pending; sweeper chạy 60 s budget nhưng xử lý 0 dòng; khách thấy license "pending" hàng giờ.
- **T:** Tôi phải làm hệ thống chạy lại trong [thời gian] mà không được sửa lớn.
- **A:** Đo: query ListAllPending mất 54–489 s nên ăn hết budget; 5 file stress test 200k component không có purl tạo 696k dòng không bao giờ enrich được; sweeper lấy "100 dòng cũ nhất" nên dòng lỗi vĩnh viễn chiếm chỗ. Làm theo thứ tự tác động: đánh dấu dòng không có purl thành no_locator (một UPDATE), tạo partial index trên dòng pending (query từ phút xuống ms), rồi đề xuất đổi sweeper sang next_retry_at + attempts và tách coordinate lỗi khỏi batch.
- **R:** Sweep xử lý được dòng ngay trong ngày; backlog giảm [X%] sau [N giờ]; bản fix cấu trúc đi vào release kế.
- **Bài học:** Khi gấp, tách "cầm máu" (data fix, index) khỏi "chữa gốc" (thiết kế lại), và ghi rõ cả hai vào ticket để không quên phần sau.

#### Chuyện 4 · statement_timeout 90 s ở cấp role (sự cố #4) — dùng cho: disagree, communication với bên khác
- **S:** Query dài trên Aurora bị giết sau 90 s; code có SET LOCAL statement_timeout nên dev tin "đã xử lý", nghi ngờ dồn về phía DB/hạ tầng.
- **T:** Tôi cần chứng minh nguyên nhân và thuyết phục hai phía (dev và vận hành DB) về cách sửa.
- **A:** Kiểm tra [[pg_db_role_setting]] thấy timeout đặt ở role; đọc 22 runner thì 18 không mở transaction nên SET LOCAL vô hiệu; viết một đoạn demo 10 dòng tái hiện. Trình bày bằng bảng "câu lệnh nào chạy trong tx, câu nào không" thay vì tranh luận; đề xuất tách role batch/API với timeout khác nhau.
- **R:** Hai bên đồng ý trong một cuộc họp; [N] runner được bọc tx hoặc chuyển role; hết lỗi 90 s ở batch.
- **Bài học:** Khi bất đồng, mang **bằng chứng tái hiện được** thay vì ý kiến; nói về hành vi hệ thống, không nói về người.

#### Chuyện 5 · Scheduled scan chập chờn (sự cố #9) — dùng cho: disagree with manager, data over opinion
- **S:** Last Scanned không cập nhật; quản lý tin rằng hàm TouchAll bị hỏng và muốn viết lại.
- **T:** Tôi được yêu cầu sửa TouchAll nhưng không tin đó là nguyên nhân.
- **A:** Đo trực tiếp: TouchAll cập nhật 953/984 target live trong lần chạy gần nhất (số 2 644 mà mọi người so sánh bao gồm target đã xoá); đối chiếu log Watchtower thấy redeploy 30 s trùng giờ tick gocron in-memory → tick bị lỡ, không có leader election, không persist lịch; runner OSV/NVD return sớm bỏ qua TouchAll. Trình bày với quản lý bằng hai con số và một timeline.
- **R:** Hướng sửa chuyển sang persist lịch + advisory lock + chạy bù tick lỡ; tránh một tuần viết lại hàm không hỏng.
- **Bài học:** Tôn trọng ý kiến quản lý nhưng xác minh bằng số trước khi code; cách nói: "Tôi đồng ý đó là giả thuyết hợp lý, cho tôi 2 giờ để kiểm chứng".

#### Chuyện 6 · Rò license giữa tenant (sự cố #15) — dùng cho: ownership, conflict về ưu tiên, bảo mật
- **S:** Dữ liệu component dùng chung giữa tenant theo kiểu first-writer-wins; license declared do tenant A upload hiện sang tenant B.
- **T:** Tôi phát hiện khi điều tra một ticket khác và phải thuyết phục đưa lên ưu tiên cao dù không có khách phàn nàn.
- **A:** Viết kịch bản tái hiện 2 tenant, định lượng phạm vi bằng SQL (bao nhiêu component có declared license khác nhau giữa tenant), đề xuất overlay per-tenant ở tầng view thay vì tách bảng (ít thay đổi schema, giữ cache dùng chung), viết ADR nêu trade-off.
- **R:** Fix vào release [X]; không còn chênh lệch cross-tenant trong kiểm tra sau release; quy tắc "dữ liệu dùng chung chỉ chứa fact khách quan, mọi thứ do tenant khai báo phải per-tenant" vào design guideline.
- **Bài học:** Lỗi bảo mật multi-tenant không chờ khách báo; nói về rủi ro bằng con số phạm vi để được ưu tiên.

### Phần 3 · Map câu hỏi → chuyện, red flag, câu hỏi ngược

#### Q2. Câu hỏi hay gặp và chuyện nào trả lời?
| Câu hỏi | Chuyện | Điểm nhấn |
|---|---|---|
| Tell me about a failure / a bug that reached production | 2, 4 | nhận phần của mình, bài học thành hệ thống |
| A time you disagreed with your manager | 5 | xác minh bằng số, tôn trọng, kết quả |
| Conflict with a teammate / other team | 4, 6 | tách người khỏi vấn đề, bằng chứng |
| Tight deadline / under pressure | 3 | ưu tiên theo tác động, cầm máu rồi chữa gốc |
| Ownership beyond your role | 1, 6 | tự nhận việc không ai giao |
| Mentoring / helping others grow | 1 | runbook, pair debugging |
| Hardest technical problem | 1, 3 | phương pháp đo trước, giả thuyết, tái hiện |
| Improved a process | 2 | alert vắng mặt, test chaos vào CI |

#### Q3. Red flag người phỏng vấn ghi nhận?
- Đổ lỗi (cho thư viện, cho ops, cho khách) hoặc "team đã..." mà không có "tôi".
- Không có số: "nhanh hơn nhiều", "khá lâu"; không biết tác động kinh doanh.
- Câu chuyện không có phần sai của mình trong câu hỏi về failure.
- Mơ hồ về quyết định: không nói được phương án đã bỏ và vì sao.
- Nói xấu công ty cũ khi hỏi lý do đổi việc.

#### Q4. Câu hỏi ngược nên hỏi interviewer (chọn 2–3)?
1. What does the on-call rotation look like, and what was the last incident the team learned the most from?
2. How does a design decision get made here: design doc, ADR, or in meetings?
3. What does success look like for this role in the first 6 months?
4. How much of the team's time goes to new features versus reliability and tech debt?
5. What observability do you have today, and what do you wish you had?
6. How are deployments done, and how often do you roll back?
7. What's the biggest technical risk in the system right now?
8. How do engineers here grow from mid to senior: what changed for the last person promoted?

#### Q5. "Vì sao đổi việc?" và "Điểm yếu của bạn?"
**Đổi việc:** Hướng về phía trước, không phàn nàn: "I've grown from implementing features to owning reliability of a multi-tenant system; I'm looking for a team where I can design systems at a larger scale and work closer to the product." Tránh lương/đồng nghiệp làm lý do chính.
**Điểm yếu:** Thật, cụ thể, có hành động: "I used to dive into debugging alone for too long before asking for help; now I timebox 2 hours, write down what I've ruled out, and share it — the statement_timeout case was solved in one meeting because of that." Không dùng điểm yếu giả ("I work too hard").

### Sai lầm hay gặp
- Kể hệ thống thay vì kể mình; không có động từ "I decided", "I measured".
- Không chuẩn bị số → bịa tại chỗ, bị hỏi sâu là lộ. Hãy tra số thật trước phỏng vấn.
- Một chuyện cho mọi câu hỏi; hoặc chuyện quá cũ (5 năm trước).
- Phần Result dài hơn Action; hoặc Action là danh sách công cụ không có quyết định.
- Quên Reflection: không biến sự cố thành quy trình, test, runbook.
- Hỏi ngược về lương/nghỉ phép ở vòng kỹ thuật.

### Nói thế nào trong phỏng vấn (EN)
- "Let me give you the context in one sentence, then what I owned, what I did, and the numbers." — Bối cảnh một câu, rồi tôi phụ trách gì, làm gì, và con số.
- "The part I got wrong was trusting the client library to reconnect; the fix I pushed for was an alert on the absence of success." — Phần tôi sai là tin thư viện tự reconnect; tôi thúc đẩy alert cho sự vắng mặt của thành công.
- "I didn't argue; I asked for two hours to reproduce it and came back with two numbers and a timeline." — Tôi không tranh cãi; xin 2 giờ tái hiện và quay lại với hai con số và timeline.
- "We stopped the bleeding with a data fix and a partial index the same day, and scheduled the structural fix for the next release." — Cầm máu bằng data fix và partial index trong ngày, fix cấu trúc vào release sau.
- "What I'd do differently is add the memory limit before the incident, not after." — Điều tôi sẽ làm khác là thêm memory limit trước sự cố, không phải sau.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Tuần này: mở 6 ticket/memory tương ứng (#3, #1, #7/#8/#16, #4, #9, #15) và điền **số thật** vào ngoặc vuông của 6 câu chuyện: thời gian phát hiện, số dòng, RSS trước/sau, số runner, ngày release; lưu thành file story bank.
- Ghi âm mỗi chuyện 90 giây bằng tiếng Anh, nghe lại, cắt mọi câu không có chủ ngữ "I".
- Với mỗi chuyện, viết 1 dòng "điều tôi làm sai hoặc sẽ làm khác" — đây là phần người phỏng vấn senior nghe kỹ nhất.
- Chuẩn bị bằng chứng có thể chia sẻ được (không lộ dữ liệu khách): sơ đồ timeline sự cố #1, bảng tx/không tx của sự cố #4, hai con số 953/984 vs 2 644 của sự cố #9.
- Biến mỗi chuyện thành một artefact công việc thật nếu chưa có: runbook OOM, test restart broker, ADR overlay per-tenant, checklist release FDW; khi kể "tôi đã lan toả bài học" phải có thứ để chỉ vào.
- Chọn 3 câu hỏi ngược phù hợp với công ty ứng tuyển (sản phẩm SaaS → hỏi on-call và rollback; outsourcing → hỏi quyền quyết định thiết kế).
- Luyện với đồng nghiệp 30 phút: họ hỏi 4 câu behavioral ngẫu nhiên từ bảng Q2, bạn trả lời, họ chấm theo red flag ở Q3.
`,
  quiz: [
    { t: 'mc', q: 'Trong câu trả lời STAR, phần nào nên chiếm nhiều thời gian nhất?', o: ['Situation — để interviewer hiểu hệ thống', 'Result — vì số liệu quan trọng nhất', 'Action — các quyết định và việc tôi trực tiếp làm, kèm lý do', 'Reflection — bài học'], a: 2, why: 'Action (~45 trong 90 giây) là nơi thể hiện năng lực cá nhân; Situation chỉ 1–2 câu.' },
    { t: 'mc', q: 'Được hỏi "Tell me about a time you failed". Câu trả lời nào là red flag?', o: ['"Thư viện AMQP không tự reconnect nên hệ thống dừng; đó là lỗi của thư viện"', '"Tôi tin thư viện tự reconnect và không thêm alert; sau sự cố tôi thêm alert vắng mặt thành công và test restart broker"', '"Tôi bỏ sót một case khi review; chúng tôi mất 2 ngày; tôi đề xuất checklist review"', '"Tôi ước lượng sai 2 lần thời gian migration; giờ tôi đo trên dữ liệu production trước khi hứa"'], a: 0, why: 'Đổ lỗi hoàn toàn cho bên ngoài và không có phần của mình hay bài học là red flag rõ nhất.' },
    { t: 'mc', q: 'Quản lý khẳng định hàm TouchAll hỏng và yêu cầu viết lại; bạn nghi ngờ nguyên nhân khác. Cách ứng xử senior nhất?', o: ['Viết lại theo yêu cầu để tránh xung đột', 'Từ chối và giải thích lý thuyết gocron', 'Hỏi ý kiến cả team trước khi làm', 'Xin một khoảng thời gian ngắn để đo (số target được cập nhật, timeline redeploy) rồi trình bày bằng số liệu'], a: 3, why: 'Tôn trọng giả thuyết, xác minh bằng dữ liệu tái hiện được, trình bày không công kích cá nhân.' },
    { t: 'mc', q: 'Câu hỏi ngược nào phù hợp nhất ở vòng kỹ thuật với engineering manager?', o: ['Chính sách tăng lương hằng năm thế nào?', 'Sự cố gần đây team học được nhiều nhất là gì và quy trình postmortem ra sao?', 'Tôi có được làm việc từ xa toàn thời gian không?', 'Công ty có bao nhiêu nhân viên?'], a: 1, why: 'Câu hỏi về sự cố và postmortem cho thấy tư duy vận hành và giúp bạn đánh giá văn hoá kỹ thuật; lương/phúc lợi để vòng HR.' },
    { t: 'mc', q: 'Trả lời "điểm yếu" tốt nhất trong các câu sau?', o: ['"Tôi quá cầu toàn nên hay làm thêm giờ"', '"Tôi không có điểm yếu đáng kể về kỹ thuật"', '"Tôi từng debug một mình quá lâu trước khi hỏi; giờ tôi timebox 2 giờ, ghi lại những gì đã loại trừ rồi chia sẻ — nhờ vậy case statement_timeout giải quyết trong một cuộc họp"', '"Tôi không giỏi giao tiếp bằng tiếng Anh"'], a: 2, why: 'Điểm yếu thật, cụ thể, có hành động khắc phục và bằng chứng kết quả; điểm yếu giả hoặc phủ nhận đều mất điểm.' },
    { t: 'fill', q: 'Điền: trong STAR, chữ A là ___ — phần mô tả các quyết định và việc bạn trực tiếp làm.', a: ['action', 'actions'], why: 'Action nên có động từ ngôi thứ nhất và lý do của từng quyết định.' },
    { t: 'fill', q: 'Điền: chữ R thứ hai trong STAR(R) là ___ — bài học và điều bạn sẽ làm khác.', a: ['reflection', 'reflect'], why: 'Reflection biến câu chuyện thành dấu hiệu trưởng thành; thiếu nó câu trả lời chỉ là báo cáo sự việc.' },
    { t: 'open', q: 'Trả lời câu "Tell me about a time something you built failed in production" bằng câu chuyện publisher RabbitMQ (sự cố #1) theo STAR(R) trong 5–7 câu, có số liệu và phần nhận trách nhiệm.', a: 'Situation: apiserver có một publisher AMQP singleton; sau khi Watchtower recreate container RabbitMQ, publisher không reconnect nên mọi cron scan/sync im lặng nhiều ngày mà không có alert. Task: tôi điều tra vì dữ liệu không cập nhật dù job báo chạy. Action: dựng timeline từ updated_at trong DB khớp với thời điểm recreate broker, đọc code thấy kết nối tạo một lần và lỗi publish chỉ log debug, viết test integration restart broker để tái hiện, sửa reconnect có backoff, đưa lỗi publish lên metric và đề xuất alert no-success-in-N-minutes với treat missing data breaching. Result: thời gian phát hiện giảm từ nhiều ngày xuống N phút theo thiết kế alert; test restart broker chạy trong CI. Reflection: phần tôi sai là tin thư viện tự reconnect và chỉ alert trên lỗi, không alert trên sự vắng mặt của thành công; bài học đó đã thành checklist cho mọi client giữ kết nối dài.', keys: ['reconnect', 'alert', 'timeline', 'test', 'bài học'] }
  ]
},
{ id: 'K10', type: 'knowledge', topic: 'observability', title: 'Phân tích sự cố & postmortem', time: '120 phút',
  goal: 'Viết được một postmortem blameless hoàn chỉnh (timeline, detection, root cause + contributing factors, action items SMART, MTTD/MTTR), kể lại một sự cố trong 2 phút ở phỏng vấn, và biến mỗi sự cố thành 1–2 đề xuất thiết kế có thể kiểm chứng.',
  md: `
### Vấn đề cần giải
Sự cố là **dữ liệu đắt nhất** mà hệ thống tạo ra; không có postmortem thì trả tiền mà không nhận hàng. Người phỏng vấn senior hỏi "kể một sự cố" để xem bạn có **phương pháp** (timeline, tách triệu chứng/nguyên nhân/yếu tố góp phần, hành động có chủ) hay chỉ có cảm xúc. Hệ SBOM có 16 sự cố nhưng chưa có postmortem chuẩn nào — bài này viết mẫu cho sự cố #1 và tóm tắt #6, rồi rút template.

### Phần 1 · Phương pháp

#### Q1. Blameless postmortem là gì, vì sao cần?
**Trả lời mẫu:** Tài liệu phân tích sự cố với giả định **người làm việc hợp lý với thông tin họ có lúc đó**; mục tiêu là sửa hệ thống (code, alert, quy trình) chứ không tìm người sai. Lý do thực dụng: có đổ lỗi thì lần sau người ta giấu thông tin, timeline sai, root cause sai. Blameless không có nghĩa là không trách nhiệm: action item có owner và hạn. Viết cho mọi sự cố ảnh hưởng khách hoặc mất dữ liệu (SEV1–2), và cho near-miss đáng học.
**Câu vặn:** "Blameless có nghĩa là không ai chịu trách nhiệm?" → Ngược lại: trách nhiệm chuyển từ "ai gây ra" sang "ai sửa hệ thống và đến khi nào"; người gần sự cố nhất thường là người viết postmortem vì họ có nhiều thông tin nhất.

#### Q2. Các mốc thời gian và chỉ số nào cần đo?
| Chỉ số | Từ → đến | Ý nghĩa | Sự cố #1 |
|---|---|---|---|
| MTTD (detect) | lỗi bắt đầu → có người biết | chất lượng alert | nhiều ngày — không có alert |
| MTTA (acknowledge) | alert → có người nhận | on-call | không áp dụng |
| MTTM (mitigate) | biết → khách hết ảnh hưởng | runbook, rollback | [điền] giờ (restart apiserver) |
| MTTR (resolve) | biết → root cause được sửa | kỹ thuật | [điền] ngày (reconnect + alert) |
**Trả lời mẫu:** Luôn tách **mitigation** (cầm máu: restart, rollback, feature flag) khỏi **resolution** (sửa gốc); trong sự cố hãy ưu tiên mitigation, không debug trên lửa. MTTD lớn hơn MTTR là dấu hiệu thiếu observability chứ không thiếu kỹ năng sửa.

#### Q3. 5 whys, fishbone và contributing factors?
**Trả lời mẫu:** 5 whys đi theo một chuỗi nhân quả: "cron im lặng" → vì publish fail → vì kết nối chết → vì broker recreate và publisher không reconnect → vì publisher singleton tạo một lần, không có retry → vì chưa từng test restart dependency. Fishbone (Ishikawa) trải theo nhiều nhánh: code, hạ tầng, quy trình, observability, con người. Thực tế **hiếm khi có một root cause**; viết "root cause" cho điểm kỹ thuật trực tiếp và liệt kê **contributing factors**: không alert vắng mặt thành công, log ở mức debug, Watchtower recreate không báo, không có health check sâu. Mỗi factor là một action item tiềm năng.

#### Q4. Action item thế nào là tốt?
| Tiêu chí | Tệ | Tốt |
|---|---|---|
| Specific | "cải thiện monitoring" | "alert khi publish_success_total = 0 trong 15 phút, treat missing = breaching" |
| Measurable | "ổn định hơn" | "MTTD < 15 phút cho lớp sự cố cron im lặng" |
| Assigned | "team" | tên người |
| Realistic | "viết lại hệ thống queue" | "reconnect có backoff trong publisher, test restart broker vào CI" |
| Time-bound | "sớm" | "trước release 2.3.1, ngày ..." |
**Trả lời mẫu:** Phân loại theo tầng phòng thủ: **prevent** (reconnect), **detect** (alert, health check), **mitigate** (runbook restart, feature flag). Một sự cố nên ra 3–6 action; nhiều hơn là không ai làm. Theo dõi action chưa xong trong review hằng tuần.

### Phần 2 · Postmortem mẫu — Sự cố #1: RabbitMQ publisher không reconnect

**Tóm tắt.** Sau khi Watchtower recreate container RabbitMQ, publisher AMQP singleton trong apiserver mất kết nối và không reconnect. Mọi cron publish (scheduled scan, sync vulnerability, audit event) thất bại im lặng trong nhiều ngày. Phát hiện khi khách báo Last Scanned không thay đổi (ticket 2628). Mức độ: SEV2 (dữ liệu vulnerability không cập nhật, không mất dữ liệu).
**Ảnh hưởng.** 100% tenant không có scan định kỳ trong [N] ngày; Last Scanned đứng từ ngày 22/7; audit event bị mất trong khoảng đó (không recover được); [X] ticket khách.
| Thời điểm | Sự kiện | Loại |
|---|---|---|
| T0 | Watchtower kéo image rabbitmq mới, recreate container; kết nối AMQP cũ bị đóng | trigger |
| T0 + 1 phút | apiserver log "channel closed" ở mức debug; publish trả lỗi, cron vẫn báo "done" | lỗi im lặng |
| T0 + 1 ngày → | scan định kỳ không chạy; dashboard Last Scanned đứng yên; không alert | ảnh hưởng |
| T0 + [N] ngày | khách báo Last Scanned không đổi → ticket 2628 | detection |
| + 2 giờ | kỹ sư dựng timeline từ t_vulnerabilities.updated_at, khớp với log recreate broker | chẩn đoán |
| + 3 giờ | restart apiserver → publisher tạo kết nối mới; cron chạy lại | mitigation |
| + [M] ngày | reconnect có backoff, metric publish, alert no-success; test restart broker | resolution |
**Detection.** Bởi khách, không bởi hệ thống. Alert hiện có chỉ bắt **lỗi** (error rate), không bắt **vắng mặt của thành công**; cron ghi log "completed" dù publish fail vì lỗi bị nuốt.
**Root cause.** Publisher là singleton khởi tạo một lần; không có vòng reconnect; lỗi publish được log debug và không lan lên caller.
**Contributing factors.** (1) Watchtower recreate dependency bất kỳ lúc nào, không thông báo; (2) không có health check sâu kiểm tra channel AMQP; (3) chưa từng test restart broker; (4) cron không có metric success per job; (5) runbook không có bước "kiểm tra kết nối broker" khi dữ liệu không cập nhật.
**Điều tốt.** Dựng lại được lịch sử từ updated_at; mitigation nhanh sau khi hiểu; không mất dữ liệu vulnerability.
**Điều chưa tốt.** MTTD nhiều ngày; audit event mất không recover; một tuần nghi ngờ sai hướng (TouchAll).
| Action | Loại | Owner | Hạn |
|---|---|---|---|
| Publisher reconnect với backoff + jitter; publish trả lỗi cho caller | prevent | [tên] | release kế |
| Metric publish_success_total/publish_error_total theo publisher; alert "0 success trong 15 phút", treat missing = breaching | detect | [tên] | 1 tuần |
| Health check /ready kiểm tra channel AMQP còn mở | detect | [tên] | 1 tuần |
| Integration test restart broker (testcontainers) vào CI | prevent | [tên] | 2 tuần |
| Pin tag image rabbitmq, Watchtower chỉ theo dõi tag cụ thể; thông báo Slack khi recreate | mitigate | [tên] | 1 tuần |
| Runbook "dữ liệu không cập nhật": bước 1 kiểm tra publisher/queue depth | mitigate | [tên] | 1 tuần |

### Phần 3 · Tóm tắt postmortem #6 và cách dùng trong phỏng vấn

#### Postmortem rút gọn — Sự cố #6: DB pilot ghim 100% CPU, 55% request 500
**Tóm tắt:** Bảng policy violation scope 9,6 triệu dòng chỉ có index PK; 238 policy được đánh giá liên tục → mỗi vòng seq scan toàn bảng → Postgres 4 vCPU 100%, pool "conn busy", 55% request 500. **Detection:** alert 5xx (tốt) nhưng chẩn đoán ban đầu nhắm vào "conn busy" (triệu chứng). **Root cause:** thiếu index theo mẫu truy vấn + vòng đánh giá không giới hạn. **Contributing:** không có review index khi bảng vượt 1 triệu dòng; không có giới hạn tần suất eval; pilot 4 vCPU shared_buffers 160 MB. **Action:** index (policy_id, target_id) CONCURRENTLY; eval theo lịch/incremental thay vì liên tục; alert seq_scan trên bảng > 1M dòng; checklist "bảng lớn phải có index theo query" trong PR review.

#### Q5. Kể một sự cố trong 2 phút ở phỏng vấn?
**Trả lời mẫu:** 20 s bối cảnh + ảnh hưởng bằng số; 30 s phát hiện và cách tôi chẩn đoán (phương pháp, không phải may mắn); 20 s mitigation; 30 s root cause + contributing factors; 20 s action items và cái gì đã đổi trong hệ thống/quy trình. Kết bằng một câu "điều tôi sẽ làm khác". Dùng động từ "I measured", "I ruled out", "I proposed".

#### Q6. Biến sự cố thành đề xuất thiết kế?
| Sự cố | Nguyên lý rút ra | Đề xuất kiểm chứng được |
|---|---|---|
| #1 publisher stale | alert cho sự vắng mặt của thành công | alert no-success-in-N-min; health check sâu; chaos test restart |
| #2 Lambda mất env | config là code, fail-fast | mustEnv ở init; Terraform; drift detection |
| #3 OOM vô hình | mọi tiến trình phải có giới hạn và lỗi phải hiện hình | mem_limit, GOMEMLIMIT, alert RSS 80% |
| #7/#8 batch nhiễm độc, zombie | cô lập lỗi theo phần tử; hàng đợi có attempts/backoff | kết quả per-item; next_retry_at; trạng thái dead |
| #9 lịch in-memory | lịch là dữ liệu bền, có lock | bảng schedule + advisory lock + chạy bù |
| #12 publish trước commit | outbox | bảng outbox + relay; consumer idempotent |

#### Template postmortem (copy vào wiki)
1. Tiêu đề, ngày, mức độ (SEV), người viết, trạng thái (draft/reviewed).
2. Tóm tắt 3 câu: chuyện gì, ảnh hưởng ai, bao lâu.
3. Ảnh hưởng bằng số: tenant, request, dữ liệu, tiền, ticket.
4. Timeline bảng: thời điểm, sự kiện, loại (trigger/detection/mitigation/resolution).
5. Detection: ai phát hiện, bằng gì; vì sao alert không kêu.
6. Root cause và contributing factors (5 whys hoặc fishbone đính kèm).
7. Điều tốt / chưa tốt / may mắn.
8. Action items SMART theo prevent/detect/mitigate, owner, hạn.
9. Bài học chung cho hệ thống khác (một đoạn).

### Sai lầm hay gặp
- Root cause = "lỗi con người" hoặc "thư viện" → không có action nào thay đổi hệ thống.
- Timeline không có thời điểm phát hiện và mitigation riêng → không tính được MTTD/MTTM.
- Action item "cải thiện monitoring" không owner, không hạn; 15 action không ai làm.
- Postmortem viết sau 3 tuần khi mọi người quên; viết trong 48 giờ.
- Chỉ phân tích triệu chứng ("conn busy") rồi dừng.
- Trong phỏng vấn kể dài dòng về chaos của ngày hôm đó, không có phương pháp.

### Nói thế nào trong phỏng vấn (EN)
- "Detection took days because we only alerted on errors, not on the absence of success; that was the first thing I changed." — Phát hiện mất nhiều ngày vì chỉ alert lỗi, không alert vắng mặt thành công; đó là điều tôi đổi đầu tiên.
- "We mitigated by restarting the service within an hour of understanding it, and fixed the root cause in the next release." — Cầm máu bằng restart trong một giờ sau khi hiểu, sửa gốc ở release kế.
- "The direct cause was a singleton publisher with no reconnect; the contributing factors were the missing deep health check and the fact that we'd never tested a broker restart." — Nguyên nhân trực tiếp là publisher singleton không reconnect; yếu tố góp phần là thiếu health check sâu và chưa từng test restart broker.
- "Every action item has an owner and a date, and we review open ones weekly." — Mỗi action có owner và hạn, review hằng tuần.
- "We run blameless postmortems: the question is what in the system let this happen, not who did it." — Postmortem blameless: câu hỏi là hệ thống đã để chuyện này xảy ra thế nào, không phải ai làm.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Tuần này viết postmortem #1 thật theo mẫu trên, điền N ngày, số ticket, thời gian mitigation từ log và memory; gửi team review 30 phút; chốt 4–6 action có tên và hạn.
- Viết postmortem rút gọn (10 dòng) cho #3, #6, #2; đặt tất cả vào một thư mục postmortems/ trong wiki với index và trạng thái action.
- Tạo dashboard "absence of success": mỗi cron/publisher một panel "thời gian từ lần thành công cuối"; alert khi vượt 2 chu kỳ; đây là action chung cho #1, #9, #12.
- Thêm vào runbook mục "Dữ liệu không cập nhật": kiểm tra queue depth, publisher metric, lần chạy cuối của scheduler, Watchtower log — theo đúng thứ tự đã mất thời gian ở sự cố #1 và #9.
- Game day quý này: restart RabbitMQ trên Canary trong giờ làm việc, đo MTTD thực tế với alert mới; ghi kết quả vào postmortem như "verification".
- Quy ước: mọi ticket Bug mức cao đóng phải có link postmortem hoặc dòng "không cần postmortem vì ...".
- Chuẩn bị phiên bản 2 phút tiếng Anh cho #1 và #6 để dùng ở phỏng vấn; ghi âm và cắt dưới 2 phút.
`,
  quiz: [
    { t: 'mc', q: 'Sự cố cron im lặng nhiều ngày trước khi khách báo. Chỉ số nào phản ánh vấn đề này và việc cần ưu tiên?', o: ['MTTR cao → cần kỹ sư giỏi hơn', 'MTTD cao → cần alert cho sự vắng mặt của thành công', 'MTTA cao → cần on-call rotation', 'MTTM cao → cần runbook rollback'], a: 1, why: 'Thời gian phát hiện (MTTD) là nhiều ngày; nguyên nhân là chỉ alert lỗi, không alert khi không có thành công.' },
    { t: 'mc', q: 'Trong postmortem blameless, câu nào là root cause hợp lệ?', o: ['Kỹ sư A quên thêm reconnect', 'Vận hành đã recreate broker không báo trước', 'Thư viện AMQP kém', 'Publisher singleton khởi tạo một lần, không có vòng reconnect, lỗi publish bị nuốt ở mức debug'], a: 3, why: 'Root cause phải là thuộc tính của hệ thống dẫn tới action kỹ thuật; ba phương án kia là đổ lỗi người hoặc bên ngoài.' },
    { t: 'mc', q: 'Action item nào đạt tiêu chí SMART?', o: ['"Alert khi publish_success_total = 0 trong 15 phút với treat missing = breaching; owner Nghia; trước release 2.3.1"', '"Cải thiện monitoring cho queue"', '"Team xem xét lại kiến trúc messaging"', '"Thêm test cho publisher khi có thời gian"'], a: 0, why: 'Cụ thể, đo được, có người, khả thi, có hạn; các phương án khác thiếu ít nhất 2 tiêu chí.' },
    { t: 'mc', q: 'DB pilot 100% CPU, pool báo "conn busy", 55% request 500. Postmortem nên ghi "conn busy" là gì?', o: ['Root cause', 'Trigger', 'Triệu chứng (symptom) — root cause là seq scan bảng 9,6 triệu dòng thiếu index trong vòng eval liên tục', 'Contributing factor chính'], a: 2, why: 'Pool bận vì query chậm giữ kết nối; sửa pool không giải quyết gì; tách triệu chứng khỏi nguyên nhân là kỹ năng cốt lõi.' },
    { t: 'mc', q: 'Thứ tự ưu tiên đúng khi sự cố đang diễn ra?', o: ['Tìm root cause trước để sửa triệt để', 'Mitigation (restart/rollback/flag) để khách hết ảnh hưởng, rồi mới điều tra root cause', 'Viết postmortem ngay để không quên', 'Thông báo khách trước khi làm gì'], a: 1, why: 'Trong sự cố ưu tiên cầm máu; debug trên lửa kéo dài ảnh hưởng. Thông báo và postmortem song song/sau.' },
    { t: 'fill', q: 'Điền: postmortem ___ giả định mọi người hành động hợp lý với thông tin có lúc đó và tập trung sửa hệ thống thay vì tìm người sai.', a: ['blameless'], why: 'Blameless không bỏ trách nhiệm: action item vẫn có owner và hạn.' },
    { t: 'fill', q: 'Điền: chỉ số đo thời gian từ khi biết sự cố đến khi root cause được sửa xong là ___ (viết tắt).', a: ['mttr', 'mean time to resolve', 'mean time to recovery'], why: 'Tách khỏi MTTM (mitigate) và MTTD (detect) để biết điểm yếu nằm ở đâu.' },
    { t: 'open', q: 'Viết tóm tắt postmortem 6–8 câu cho sự cố Lambda mất biến môi trường (#2): ảnh hưởng, detection, root cause, contributing factors, 3 action items.', a: 'Tóm tắt: sau một lần redeploy, Lambda enrichment mất REDIS_HOST và RABBITMQ_*, code fallback localhost nên cache và publish inline thất bại; enrichment pending kẹt nhiều giờ cho mọi tenant. Detection: do kỹ sư thấy pending không giảm khi kiểm tra ticket khác, không có alert. Root cause: env được quản lý tay ngoài IaC nên lệnh cập nhật cấu hình ghi đè thiếu biến; code có fallback localhost thay vì fail-fast. Contributing factors: không có metric success của enrichment, không có smoke test sau deploy, log lỗi kết nối ở mức thấp. Action: (1) env vào Terraform/SAM và đọc từ Parameter Store, cấm sửa console; (2) mustEnv ở init, thiếu biến thì lỗi ngay và alarm trên Errors; (3) alert "0 enrichment success trong 30 phút" treat missing = breaching và smoke test invoke sau mỗi deploy. Bài học: cấu hình là một phần của code và hệ thống phải thất bại ồn ào.', keys: ['fail-fast', 'Terraform', 'alert', 'contributing', 'smoke test'] }
  ]
},
{ id: 'K11', type: 'knowledge', topic: 'design', title: 'Design doc, ADR và capacity planning trong công việc thật', time: '120 phút',
  goal: 'Viết được design doc 1–2 trang và ADR theo template, lập capacity plan 12 tháng bằng bảng, chạy production readiness review với checklist, review design của người khác bằng 10 câu hỏi, và thuyết phục bằng số liệu đo trước khi sửa.',
  md: `
### Vấn đề cần giải
Kỹ sư mid viết code theo ticket; kỹ sư senior **viết quyết định xuống giấy trước khi code** để người khác phản biện, để 6 tháng sau biết vì sao hệ thống như vậy, và để ước lượng không thành lời hứa suông. Hệ SBOM có nhiều quyết định ngầm (publish trước commit, lịch in-memory, Preload toàn bộ) mà không ai nhớ ai quyết; mỗi cái sau này thành sự cố. Design doc, ADR và capacity plan là ba công cụ rẻ nhất để chuyện đó không lặp lại — và là thứ người phỏng vấn senior hỏi: "How do design decisions get made in your team?"

### Phần 1 · Design doc

#### Q1. Design doc 1–2 trang gồm gì?
| Mục | Nội dung | Độ dài |
|---|---|---|
| Context | vấn đề, số liệu hiện tại, vì sao bây giờ | 5–8 dòng |
| Goals / Non-goals | goals đo được; **non-goals** để chặn scope creep | 3 + 3 gạch |
| Proposal | thiết kế đề xuất: sơ đồ, luồng, data model, API thay đổi | nửa trang |
| Alternatives | 2–3 phương án đã cân nhắc, vì sao không chọn (bảng) | 6–10 dòng |
| Risks & mitigations | gì có thể hỏng, phát hiện thế nào, rollback ra sao | 4–6 dòng |
| Rollout | giai đoạn, feature flag, migration, môi trường Canary → pilot → prod | 4–6 dòng |
| Metrics | số nào chứng minh thành công/thất bại, đo ở đâu | 3–5 dòng |
| Open questions | điều chưa chốt, cần ai trả lời | 2–4 dòng |
**Trả lời mẫu:** Viết Context và Goals trước, gửi sớm khi mới 30% để lấy phản biện rẻ; review bất đồng bộ bằng comment, họp 30 phút chỉ để chốt open questions. Doc được **đóng băng** sau khi quyết; thay đổi lớn sau đó là ADR mới. Dài hơn 2 trang nghĩa là nên tách.
**Câu vặn:** "Khi nào không cần design doc?" → Thay đổi đảo ngược được trong một PR, không đụng schema/API/hạ tầng; nhưng vẫn ghi lý do trong PR description.

### Phần 2 · ADR

#### Q2. ADR là gì và viết thế nào?
**Trả lời mẫu:** Architecture Decision Record: tài liệu 1 trang cho **một** quyết định, bất biến sau khi chấp nhận (chỉ đổi status: proposed → accepted → deprecated/superseded by ADR-xxx). Cấu trúc: Title, Status, Context (lực tác động, ràng buộc), Decision (một câu chủ động "Chúng tôi sẽ..."), Consequences (tốt, xấu, việc phải làm thêm). Đánh số, lưu trong repo cạnh code để review như code.

#### ADR-007 · Dùng transactional outbox cho audit log (sự cố #12)
- **Status:** Accepted.
- **Context:** Audit event hiện publish lên RabbitMQ **trước** khi transaction commit; consumer đọc trước khi dữ liệu tồn tại → FK violation, event bị drop, mất log audit (yêu cầu tuân thủ). Publisher lỗi khi broker down cũng làm mất event (sự cố #1). Cần đảm bảo "nếu nghiệp vụ commit thì event chắc chắn được phát, ít nhất một lần".
- **Decision:** Ghi event vào bảng [[outbox]] trong **cùng transaction** với dữ liệu nghiệp vụ; một relay (goroutine trong worker, poll 1 s với SKIP LOCKED hoặc LISTEN/NOTIFY) đọc outbox và publish, đánh dấu sent. Consumer idempotent theo event_id.
- **Alternatives bị loại:** (a) publish sau commit trong code — mất event nếu crash giữa commit và publish; (b) CDC/Debezium — đúng về kỹ thuật nhưng thêm một hệ thống phải vận hành; (c) 2PC — không có với RabbitMQ.
- **Consequences:** (+) không mất event, broker down chỉ gây trễ; (+) thứ tự theo aggregate giữ được bằng ORDER BY id. (−) độ trễ thêm ~1 s; (−) bảng outbox cần dọn (xoá sent > 7 ngày, partial index WHERE sent_at IS NULL); (−) consumer phải idempotent (unique event_id).
- **Việc kèm:** migration outbox; metric outbox_lag_seconds + alert > 60 s; test "publish trước commit" không còn xảy ra.

#### ADR-008 · Dùng Postgres advisory lock + bảng schedule cho scheduler (sự cố #9)
- **Status:** Accepted.
- **Context:** gocron in-memory trên mỗi instance; Watchtower redeploy làm lỡ tick; chạy 2 instance thì job chạy đôi; không persist lịch nên không biết lần chạy cuối. Tần suất job: 15 phút đến 1 ngày; không cần độ chính xác giây.
- **Decision:** Bảng [[schedules(name, cron, next_run_at, last_run_at, locked_until)]]; mỗi instance tick 30 s chạy [[SELECT ... WHERE next_run_at <= now() FOR UPDATE SKIP LOCKED]] (hoặc [[pg_try_advisory_xact_lock(hashtext(name))]]) → chỉ một instance chạy; xong cập nhật last_run_at, next_run_at; tick lỡ được chạy bù ngay khi instance lên.
- **Alternatives bị loại:** (a) Redis lock SET NX — thêm điểm hỏng, Redis từng mất kết nối (sự cố #2); (b) leader election (etcd/ZooKeeper) — quá nặng cho 2 instance; (c) EventBridge Scheduler → Lambda — tách rời khỏi worker, job > 15 phút không hợp.
- **Consequences:** (+) không chạy đôi, không lỡ tick, có lịch sử; (+) dùng DB sẵn có. (−) job vẫn phải idempotent vì có thể bị kill giữa chừng (lease [[locked_until]] thu hồi); (−) độ phân giải 30 s. **Metric:** [[seconds_since_last_success]] mỗi job, alert > 2 chu kỳ.

### Phần 3 · Capacity plan và production readiness

#### Q3. Capacity plan worksheet 12 tháng?
| Chỉ số | Hiện tại (đo) | 12 tháng (giả định x3 tenant) | Giới hạn hiện tại | Hành động |
|---|---|---|---|---|
| Tenant / project | [T] / [P] | 3T / 3P | — | — |
| Component (tổng dòng) | [C] | 3C | bảng 9,6M violation đã làm DB 100% khi thiếu index | index, partition theo tenant |
| Link component–vuln | [L] (project lớn nhất 490k) | 3L | Preload toàn bộ → OOM 5 GiB | batch query, giới hạn song song |
| DB size | [G] GB, tăng [g] GB/tháng | G + 12g | đĩa, autovacuum | lifecycle revision cũ, partition |
| API RPS đỉnh | [R] | 3R | 4 vCPU pilot, p95 > 5 s ở 3 trang | cache, index, read replica |
| Enrichment / ngày | [E] coordinate | 3E | rate limit API ngoài, Lambda 15 phút | batch lớn hơn, cache Redis L1 |
| Worker RAM đỉnh | [W] GB | ? đo lại sau fix | không có limit | mem_limit, GOMEMLIMIT |
**Trả lời mẫu:** Nguyên tắc: **đo trước** (mỗi ô "hiện tại" phải có nguồn: query, dashboard, ngày đo), giả định tăng trưởng viết rõ, headroom mục tiêu 30–50% ở đỉnh, xác định **thứ gãy đầu tiên** (ở SBOM: DB CPU và RAM worker, không phải API server) và hành động trước 3–6 tháng khi dự báo chạm 70%. Cập nhật mỗi quý.

#### Q4. Production readiness review (PRR) checklist?
- Timeout cho mọi call ra ngoài (DB, HTTP, queue) và cho mỗi request vào; không có timeout vô hạn.
- Retry có backoff + jitter + giới hạn, chỉ cho thao tác idempotent; DLQ cho message.
- Giới hạn tài nguyên: memory limit, GOMEMLIMIT, pool size, concurrency per job, rate limit per tenant.
- Observability: metric RED (rate, errors, duration) + "seconds since last success" cho job; log có tenant_id/request_id; trace qua queue.
- Alert có owner, runbook link, và ngưỡng được kiểm tra bằng game day; alert cho sự vắng mặt của thành công.
- Health check sâu (DB, broker, cache) tách khỏi liveness.
- Backup có **restore test** (ngày gần nhất?), RPO/RTO ghi rõ.
- Rollback: cách rollback code (tag image pinned) và DB (migration tương thích ngược, expand–contract).
- Config: không secret trong image; fail-fast khi thiếu; IaC là nguồn sự thật.
- Capacity: đã load test ở 2x tải dự kiến; biết thứ gãy đầu tiên.
- Bảo mật multi-tenant: mọi query có tenant_id; dữ liệu dùng chung chỉ chứa fact khách quan (bài học #15).

### Phần 4 · Review, ước lượng, thuyết phục

#### Q5. 10 câu hỏi khi review design của người khác
1. Số liệu hiện tại ở đâu, đo khi nào? 2. Non-goals là gì — ta cố tình không làm gì? 3. Điều gì xảy ra khi dependency X chết/chậm 10 lần? 4. Thao tác này idempotent chưa, retry từ đâu? 5. Thứ gãy đầu tiên khi tải x3 là gì? 6. Làm sao biết nó đang hoạt động đúng (metric nào), và biết nó hỏng trong bao lâu? 7. Rollback thế nào nếu migration đã chạy? 8. Phương án đơn giản hơn đã bị loại vì sao? 9. Ai vận hành lúc 2 giờ sáng, runbook nào? 10. Dữ liệu tenant có thể rò sang tenant khác ở bước nào?
**Trả lời mẫu:** Review là hỏi, không là áp đặt; mỗi câu hỏi nên mở ra một dòng trong Risks hoặc Alternatives. Ưu tiên phản biện ở ranh giới (API, schema, queue) vì đó là chỗ đắt khi đổi.

#### Q6. Ước lượng effort thế nào cho đáng tin?
**Trả lời mẫu:** Chia việc thành phần ≤ 2 ngày; ước lượng 3 điểm (lạc quan / khả dĩ / bi quan) và dùng công thức (O + 4M + P) / 6; cộng rõ ràng thời gian cho test tích hợp, migration, rollout, review — thường bằng thời gian code. Việc "chưa biết" (spike) ước lượng bằng **timebox** rồi mới cam kết. Nói khoảng, không nói điểm: "7–10 ngày, biết chắc hơn sau spike 1 ngày". Ghi lại ước lượng vs thực tế để hiệu chỉnh.

#### Q7. Thuyết phục bằng số liệu — đo trước khi sửa?
**Trả lời mẫu:** Ba bước: (1) **đo hiện trạng** có thể tái hiện (query, profile, timeline); (2) **dự đoán** kết quả nếu sửa ("partial index sẽ đưa query từ 54–489 s xuống dưới 1 s vì chỉ quét 0,5% dòng"); (3) **đo lại** sau khi sửa và công bố. Sự cố #9: thay vì viết lại TouchAll như đề xuất, đo được 953/984 target cập nhật → tránh một tuần công vô ích. Sự cố #6: EXPLAIN trước/sau index là lập luận duy nhất cần. Trình bày: một bảng trước/sau, một câu kết luận, một đề xuất; không slide dài.

### Sai lầm hay gặp
- Design doc 10 trang không ai đọc; không có Non-goals nên scope phình.
- ADR viết sau khi đã code xong để hợp thức hoá; hoặc sửa ADR cũ thay vì tạo ADR mới.
- Capacity plan toàn số tròn không nguồn; không chỉ ra thứ gãy đầu tiên.
- PRR làm ở ngày deploy; alert không có runbook; backup chưa từng restore.
- Ước lượng một con số, không tách spike, quên thời gian test/rollout.
- Tranh luận bằng ý kiến khi 15 phút đo là có số.

### Nói thế nào trong phỏng vấn (EN)
- "I write a one-to-two-page design doc with explicit non-goals and send it at 30% so the feedback is cheap." — Design doc 1–2 trang có non-goals rõ, gửi khi 30% để phản biện rẻ.
- "Each significant decision gets an ADR: context, decision, consequences; we never edit an accepted ADR, we supersede it." — Mỗi quyết định lớn có ADR; không sửa ADR đã chấp nhận, tạo ADR mới thay thế.
- "Our capacity plan names the first thing that breaks at 3x load — in our case database CPU and worker memory, not the API tier." — Capacity plan nêu thứ gãy đầu tiên ở x3 tải: DB CPU và RAM worker.
- "Before proposing the rewrite I measured it: 953 of 984 targets were updated, so the function wasn't the problem." — Trước khi đề xuất viết lại tôi đo: 953/984 target cập nhật, hàm không phải vấn đề.
- "I give estimates as a range with the assumptions, and a one-day spike before committing to anything unknown." — Ước lượng là khoảng kèm giả định, spike một ngày trước khi cam kết điều chưa biết.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Viết thật ADR-007 (outbox cho audit log) và ADR-008 (scheduler) theo mẫu trên vào thư mục docs/adr của repo backend; mở PR để team review như code; ADR-001..006 có thể là "quyết định ngầm" đang có (FDW, Lambda enrichment, Watchtower, gocron, RabbitMQ, Redis) ghi lại với status Accepted và consequences đã thấy.
- Điền bảng capacity plan với số đo thật tuần này: COUNT theo bảng lớn, DB size từ [[pg_database_size]], RPS từ Nginx log, RAM worker từ [[docker stats]]; ghi ngày đo; chỉ ra thứ gãy đầu tiên và hạn hành động.
- Chạy PRR checklist cho worker và Lambda enrichment; ghi kết quả pass/fail từng dòng; các dòng fail (timeout, memory limit, alert vắng mặt thành công, restore test) thành ticket có owner.
- Viết design doc 2 trang cho một thay đổi sắp làm (ví dụ: thay sweeper 100-oldest bằng next_retry_at + SKIP LOCKED): có Context với số 54–489 s, Non-goals (không đổi mô hình dữ liệu PRCL), Alternatives, Rollout qua Canary, Metrics (tuổi dòng pending già nhất).
- Trước mỗi đề xuất tối ưu, đính kèm EXPLAIN ANALYZE hoặc profile trước; sau khi merge, đo lại và comment số vào ticket — tạo thói quen "trước/sau" cho cả team.
- Khi review PR của người khác, dùng 3 câu đầu của Q5 (số liệu, non-goals, dependency chết) như checklist tối thiểu.
`,
  quiz: [
    { t: 'mc', q: 'Mục nào trong design doc có tác dụng chính là chặn scope creep?', o: ['Non-goals', 'Alternatives', 'Rollout', 'Metrics'], a: 0, why: 'Non-goals nói rõ điều cố tình không làm để review không kéo thêm yêu cầu và ước lượng không phình.' },
    { t: 'mc', q: 'Một ADR đã Accepted cần thay đổi quyết định sau 6 tháng. Cách đúng?', o: ['Sửa trực tiếp phần Decision của ADR cũ', 'Xoá ADR cũ và viết lại', 'Tạo ADR mới, đặt ADR cũ status Superseded by ADR mới', 'Chỉ ghi vào changelog'], a: 2, why: 'ADR là bản ghi lịch sử bất biến; superseding giữ lại lý do của cả hai thời điểm.' },
    { t: 'mc', q: 'Transactional outbox giải quyết vấn đề nào của việc publish audit event?', o: ['Giảm độ trễ publish', 'Đảm bảo event chỉ được phát khi transaction nghiệp vụ đã commit, và không mất khi broker down', 'Bỏ nhu cầu consumer idempotent', 'Thay thế RabbitMQ bằng Postgres'], a: 1, why: 'Event ghi cùng transaction với dữ liệu; relay publish sau; consumer vẫn phải idempotent vì at-least-once.' },
    { t: 'mc', q: 'Trong capacity plan, điều quan trọng nhất cần chỉ ra là:', o: ['Tổng chi phí cloud 12 tháng', 'Số instance cần thêm', 'Phiên bản Postgres sẽ nâng', 'Thứ gãy đầu tiên khi tải tăng theo giả định, và khi nào phải hành động'], a: 3, why: 'Plan tồn tại để hành động trước khi chạm giới hạn; biết bottleneck đầu tiên quyết định mọi thứ khác.' },
    { t: 'mc', q: 'Quản lý đề xuất viết lại một hàm nghi hỏng (ước 1 tuần). Bước senior đầu tiên?', o: ['Bắt đầu viết lại theo ước lượng', 'Lập design doc cho hàm mới', 'Đo hành vi hiện tại trong 1–2 giờ để xác nhận hàm có hỏng thật không', 'Hỏi ý kiến thêm 3 kỹ sư khác'], a: 2, why: 'Đo trước khi sửa: sự cố #9 cho thấy 953/984 target được cập nhật, hàm không phải nguyên nhân, tiết kiệm một tuần.' },
    { t: 'fill', q: 'Điền: tài liệu một trang ghi lại một quyết định kiến trúc với các mục Context, Decision, Consequences, viết tắt là ___.', a: ['adr', 'architecture decision record'], why: 'ADR lưu cạnh code, đánh số, status proposed/accepted/superseded.' },
    { t: 'fill', q: 'Điền: trong design doc, mục liệt kê những điều cố tình KHÔNG làm trong phạm vi này gọi là ___.', a: ['non-goals', 'non goals', 'nongoals'], why: 'Non-goals bảo vệ scope và làm rõ kỳ vọng với stakeholder.' },
    { t: 'open', q: 'Viết ADR rút gọn (6–8 câu) cho quyết định "thay OFFSET pagination bằng keyset và bỏ join FDW trong export" (sự cố #11): Context, Decision, Alternatives bị loại, Consequences, Metric.', a: 'Context: export dùng OFFSET nên trang sâu chậm O(N), join local–foreign qua FDW không push down kéo toàn bộ bảng remote, ReadAll vào RAM làm worker tốn hàng GB; trang cuối mất hàng chục giây. Decision: chúng tôi sẽ dùng keyset pagination theo (created_at, id) với index khớp, stream từng trang ra file, và thay join FDW bằng bảng cache vulnerability đồng bộ định kỳ (hoặc lookup theo id list). Alternatives bị loại: tăng statement_timeout và RAM (che triệu chứng); materialized view trên FDW (vẫn refresh chậm, lệch dữ liệu); chuyển export sang job async không đổi query (vẫn chậm, chỉ ẩn). Consequences: (+) mỗi trang O(limit), RAM hằng số, không còn phụ thuộc FDW trong request path; (−) không nhảy tới trang N bất kỳ, cần cursor; (−) cache vuln có độ trễ đồng bộ phải ghi rõ cho người dùng. Metric: thời gian export p95 và RSS worker trước/sau, độ trễ đồng bộ cache; alert khi độ trễ > 1 giờ.', keys: ['keyset', 'FDW', 'stream', 'Consequences', 'metric'] }
  ]
},
{ id: 'K12', type: 'knowledge', topic: 'behavioral', title: 'Ngày phỏng vấn system design', time: '90 phút',
  goal: 'Vào phòng phỏng vấn với kế hoạch 45 phút rõ ràng, dẫn dắt được cuộc hội thoại (nói to suy nghĩ, xác nhận, không im lặng quá 30 giây), xử lý câu hỏi không biết bằng khung an toàn, phát tín hiệu senior, và thuộc 40 câu tiếng Anh theo từng pha.',
  md: `
### Vấn đề cần giải
Kiến thức đủ nhưng **trượt vì cách chơi**: im lặng vẽ 5 phút, nhảy thẳng vào Kafka khi chưa hỏi QPS, không bao giờ nói về failure, hoặc đóng băng khi bị hỏi thứ chưa dùng. Phỏng vấn system design là **cuộc hội thoại có cấu trúc** mà bạn là người dẫn; người phỏng vấn chấm quá trình (cách hỏi, cách đánh đổi) nhiều hơn kết quả. Bài này là kịch bản ngày thi.

### Phần 1 · Format và kế hoạch

#### Q1. Format phổ biến và cần luyện gì?
| Format | Thời gian | Công cụ | Lưu ý |
|---|---|---|---|
| 1 vòng system design | 45–60 phút, 1 đề | Excalidraw, Miro, Google Drawings, đôi khi chỉ Google Doc | luyện vẽ nhanh trên đúng công cụ trước; biết phím tắt hình chữ nhật/mũi tên/text |
| 2 vòng (HLD + deep dive hoặc LLD) | 2 x 45 phút | như trên + code editor | vòng 2 hay hỏi lại quyết định vòng 1; giữ nhất quán |
| Take-home design doc + presentation | 2–4 giờ viết + 45 phút trình bày | doc | dùng template K11; chuẩn bị cho câu hỏi "vì sao không chọn X" |
| Onsite kết hợp behavioral | 30–45 phút | — | 6 câu chuyện STAR (K9) |
**Trả lời mẫu:** Hỏi recruiter trước: công cụ gì, có được dùng giấy không, interviewer là ai (backend hay infra sẽ xoáy khác nhau). Mở sẵn whiteboard trống với 4 vùng: Requirements, Estimates, Diagram, Deep dive.

#### Q2. Phân bổ 45 phút?
| Phút | Pha | Đầu ra | Dấu hiệu đi đúng |
|---|---|---|---|
| 0–5 | làm rõ yêu cầu | functional 3–6, non-functional có số, ngoài phạm vi | interviewer gật và bổ sung |
| 5–10 | ước lượng | QPS đọc/ghi, dung lượng, băng thông, cache; viết phép tính | ra được "đây là hệ đọc nhiều, 10k QPS, DB đơn không đủ" |
| 10–22 | thiết kế tổng thể | sơ đồ 6–10 hộp, luồng ghi/đọc, API, data model | interviewer hỏi "vì sao chỗ này" thay vì "chỗ này là gì" |
| 22–40 | đào sâu | 2–3 điểm nóng, mỗi điểm 2–3 phương án, chọn và lý do, failure mode | bạn tự đề xuất điểm nóng trước khi bị hỏi |
| 40–45 | kết thúc | tóm tắt trade-off, giới hạn, bước tiếp theo, hỏi ngược | kết thúc đúng giờ, không bị cắt ngang |
**Câu vặn:** "Hết giờ mà chưa đào sâu?" → Thà đào sâu 1 điểm có chiều sâu còn hơn 3 điểm nông; nói rõ "với 5 phút còn lại tôi chọn đi sâu vào X vì đó là rủi ro lớn nhất".

### Phần 2 · Dẫn dắt và xử lý tình huống

#### Q3. Dẫn dắt cuộc hội thoại thế nào?
**Trả lời mẫu:** (1) **Nói to suy nghĩ** — kể cả khi đang vẽ: "I'm drawing the write path first because it's the harder one". (2) **Checkpoint** sau mỗi pha: "Does that match what you had in mind, or should I adjust?" (3) **Không im lặng quá 30 giây**; cần nghĩ thì nói "Give me 20 seconds to think about the trade-off here". (4) Dùng **tên** cho thành phần trên sơ đồ để hai bên trỏ cùng một thứ. (5) Khi interviewer gợi ý, coi đó là tín hiệu quý: "Good point — that changes my choice of X". (6) Quản lý giờ công khai: "We're at 20 minutes; I'd like to move to the deep dive unless you want more on the API".

#### Q4. Xử lý khi bị đẩy ngược hoặc không biết?
**Trả lời mẫu:** Không bịa, không đóng băng. Khung: **thừa nhận → dùng nguyên lý gần nhất → đề xuất cách kiểm chứng**. "I haven't used X in production, but based on how Y works I'd expect X to Z; I'd confirm by W." Khi bị phản biện: tách **sự thật** khỏi **lựa chọn**: nếu sai sự thật thì sửa ngay và cảm ơn; nếu là lựa chọn thì nêu lại trade-off và hỏi ràng buộc mới: "If consistency matters more than latency here, I'd switch to synchronous replication." Khi câu hỏi quá rộng, thu hẹp: "Let me take the hot-partition case first, then the failover case."

#### Q5. Tín hiệu senior và red flag?
| Senior | Red flag |
|---|---|
| hỏi yêu cầu trước, chốt non-goals | nhảy vào giải pháp sau 30 giây |
| ước lượng ra số rồi dùng số đó để chọn | không ước lượng, hoặc ước lượng rồi bỏ đó |
| mỗi thành phần có trade-off và lý do | liệt kê công nghệ thời thượng không lý do |
| nói về failure mode: nếu X chết thì sao, retry, idempotency | hệ thống "luôn chạy" |
| nói về vận hành: metric, alert, rollout, cost | kết thúc ở sơ đồ |
| biết khi nào **không** cần phân tán | Kafka + Cassandra cho 100 QPS |
| kể kinh nghiệm thật ngắn gọn khi liên quan | "ở công ty tôi" mỗi 2 phút |

### Phần 3 · Phrase bank 40 câu (EN — VI)

#### Mở đầu (1–6)
1. "Let me make sure I understand the problem before proposing anything." — Để tôi chắc hiểu đề trước khi đề xuất.
2. "I'll spend about five minutes on requirements, five on estimates, then the design." — Tôi dành 5 phút yêu cầu, 5 ước lượng, rồi thiết kế.
3. "Who are the users, and what's the primary action they take?" — Người dùng là ai, hành động chính là gì?
4. "Is this a greenfield system, or are we extending something?" — Hệ mới hay mở rộng cái có sẵn?
5. "What does success look like for this system in six months?" — Thành công của hệ này sau 6 tháng là gì?
6. "I'll write the requirements down here so we can refer back to them." — Tôi ghi yêu cầu ở đây để tham chiếu lại.
#### Làm rõ (7–14)
7. "What's the expected scale: daily active users and peak factor?" — Quy mô: DAU và hệ số đỉnh?
8. "What's the read-to-write ratio?" — Tỉ lệ đọc/ghi?
9. "How fresh does the data need to be: seconds, minutes?" — Dữ liệu cần mới đến mức nào?
10. "What's the latency target at p99?" — Mục tiêu độ trễ p99?
11. "Can we tolerate duplicates or out-of-order events?" — Chấp nhận trùng hoặc lệch thứ tự không?
12. "Is multi-tenancy a requirement, and how strict is isolation?" — Multi-tenant có bắt buộc, cách ly chặt đến đâu?
13. "I'll treat authentication and billing as out of scope unless you want them." — Tôi để auth và billing ngoài phạm vi trừ khi anh/chị muốn.
14. "To summarize the requirements: ... Did I miss anything?" — Tóm tắt yêu cầu: ... Tôi có sót gì không?
#### Ước lượng (15–20)
15. "Ten million users, ten actions a day, gives about a thousand writes per second on average, maybe three thousand at peak." — 10 triệu người x 10 hành động ≈ 1 000 ghi/giây, đỉnh 3 000.
16. "At one kilobyte per record that's roughly a hundred gigabytes a year." — 1 KB mỗi bản ghi ≈ 100 GB/năm.
17. "That fits on a single Postgres instance for writes; reads are the problem." — Ghi vừa một Postgres; đọc mới là vấn đề.
18. "Caching the hot 20 percent would take about 20 gigabytes of memory." — Cache 20% nóng tốn ~20 GB.
19. "These are rough numbers; what matters is the order of magnitude." — Số ước, quan trọng là bậc độ lớn.
20. "Given these numbers, we don't need sharding on day one." — Với số này chưa cần shard ngày đầu.
#### Đề xuất (21–27)
21. "At a high level: clients hit a load balancer, stateless API servers, a cache, and a primary database with replicas." — Tổng thể: LB, API stateless, cache, DB chính có replica.
22. "Let me walk through the write path first, then the read path." — Đi luồng ghi trước, rồi đọc.
23. "I'll put a queue here to decouple ingestion from processing." — Đặt queue để tách nhận và xử lý.
24. "The data model has three main tables; the key is tenant plus entity id." — Data model 3 bảng; key là tenant + id.
25. "This component is the one I'd want to dig into, because it's the bottleneck." — Thành phần này tôi muốn đào sâu vì là nút cổ chai.
26. "I'm choosing Postgres over a NoSQL store because we need joins and transactions." — Chọn Postgres vì cần join và transaction.
27. "Let me name these boxes so we can refer to them." — Đặt tên các hộp để dễ trỏ.
#### Trade-off (28–35)
28. "The trade-off here is latency versus consistency; I'd pick eventual consistency because..." — Đánh đổi độ trễ và nhất quán; tôi chọn eventual vì...
29. "If this cache goes down, the database must handle the full load, so I'd add a circuit breaker and request coalescing." — Cache chết thì DB chịu toàn tải, nên thêm circuit breaker và gộp request.
30. "The consumer must be idempotent because the queue is at-least-once." — Consumer phải idempotent vì queue at-least-once.
31. "An alternative is X; it's simpler but doesn't handle Y, which we said matters." — Phương án khác là X; đơn giản hơn nhưng không xử lý Y mà ta đã nói là quan trọng.
32. "I haven't run X in production, but based on Y I'd expect Z; I'd validate with a load test." — Chưa chạy X trên production, nhưng từ Y tôi dự đoán Z; kiểm chứng bằng load test.
33. "That's a fair point; it changes my choice — let me revise." — Điểm hợp lý; nó đổi lựa chọn của tôi, để tôi sửa.
34. "For observability I'd track rate, errors, duration, and time since last successful job." — Theo dõi rate, errors, duration và thời gian từ job thành công cuối.
35. "The first thing that breaks at ten times the load is the database; here's how I'd shard it." — Thứ gãy đầu tiên ở x10 tải là DB; đây là cách shard.
#### Kết thúc (36–40)
36. "To summarize: we chose A over B for reason C, and the main risk is D, mitigated by E." — Tóm lại: chọn A thay vì B vì C, rủi ro chính D, giảm bằng E.
37. "With more time I'd look at the backfill process and the cost model." — Có thêm giờ tôi sẽ xem backfill và chi phí.
38. "Known limitations: the design assumes a single region." — Giới hạn đã biết: giả định một region.
39. "Is there an area you'd like me to go deeper on in the remaining minutes?" — Có phần nào anh/chị muốn tôi đào sâu trong phút còn lại?
40. "Thanks — could you share one thing I could have done better in this session?" — Cảm ơn; có điều gì tôi nên làm tốt hơn trong buổi này?

### Phần 4 · Checklist và feedback

#### Đêm trước
- Ôn 3 khung: 5 pha 45 phút, 6 câu chuyện STAR, bảng số liệu cần nhớ (RTT, SSD, QPS/máy, 10^5 giây/ngày).
- Thử công cụ whiteboard trong 10 phút; chuẩn bị template 4 vùng; kiểm tra mic, camera, mạng dự phòng (4G).
- Đọc lại 1 case đã làm, không học bài mới; ngủ đủ.
#### 10 phút trước
- Mở whiteboard trống, giấy bút, nước; tắt thông báo.
- Đọc 5 câu mở đầu và 5 câu kết thúc thành tiếng.
- Viết lên giấy: "hỏi trước — ước lượng — trade-off — failure — vận hành".
#### Xin và dùng feedback
- Cuối buổi hỏi câu 40; sau buổi gửi email cảm ơn ngắn, hỏi recruiter về điểm mạnh/yếu nếu không đậu.
- Trong 30 phút sau buổi, ghi lại: đề, câu hỏi bị hỏi, chỗ lúng túng, câu trả lời tốt hơn; đưa vào bộ case để luyện.

### Sai lầm hay gặp
- Vẽ xong sơ đồ 10 hộp trong im lặng rồi mới quay lại nói.
- Cãi với interviewer về sự thật kỹ thuật thay vì nói "có thể tôi nhầm, logic của tôi là..."
- Dùng mọi phút cho HLD, không còn thời gian deep dive — chỗ phân biệt mid và senior.
- Không bao giờ nói "failure", "retry", "idempotent", "alert".
- Bịa kinh nghiệm với công nghệ chưa dùng; bị hỏi sâu là lộ.
- Không hỏi feedback, không ghi chép sau buổi, lặp lại lỗi ở công ty sau.

### Nói thế nào trong phỏng vấn (EN)
- "Let me think out loud so you can redirect me if I'm going somewhere unhelpful." — Để tôi nói to suy nghĩ để anh/chị chỉnh hướng nếu cần.
- "We're at the 20-minute mark; I'd like to move to the deep dive on the queue unless you prefer otherwise." — Đang ở phút 20; tôi muốn chuyển sang đào sâu queue trừ khi anh/chị muốn khác.
- "I don't know X well enough to be certain; here's my reasoning and how I'd verify it." — Tôi không chắc về X; đây là lập luận và cách tôi kiểm chứng.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Dùng chính hệ SBOM làm đề mock: "Design a multi-tenant SBOM analysis platform" — chạy 45 phút với đồng nghiệp bấm giờ theo bảng Q2; bạn có lợi thế biết sự cố thật để nói về failure mode.
- Chuẩn bị 3 câu kinh nghiệm thật ngắn (≤ 20 giây) chèn vào đúng chỗ: queue → "we learned the hard way that a publisher must reconnect" (#1); worker → "we OOM'd at 5 GiB from an unbounded preload" (#3); scheduler → "in-memory cron missed ticks on redeploy" (#9). Không kể quá 3 lần một buổi.
- Luyện phrase bank theo pha: mỗi ngày 1 pha, ghi âm, nghe lại; ưu tiên câu 14, 19, 28, 32, 36 — năm câu cứu nhiều tình huống nhất.
- Vẽ sơ đồ SBOM hiện tại trên Excalidraw trong 3 phút: upload → parse → enrich (Lambda) → policy → notification; nếu mất hơn 3 phút thì luyện công cụ thêm.
- Lập danh sách "điều tôi chưa dùng production" (Kafka, Cassandra, Kubernetes...) và với mỗi cái viết sẵn một câu khung 32 dựa trên thứ bạn đã dùng (RabbitMQ, Postgres, docker-compose).
- Sau mỗi buổi mock hoặc phỏng vấn thật, ghi 10 dòng vào nhật ký phỏng vấn theo mục "Xin và dùng feedback"; sau 3 buổi, nhìn lại lỗi lặp.
`,
  quiz: [
    { t: 'mc', q: 'Bạn còn 6 phút, chưa đào sâu điểm nào. Lựa chọn tốt nhất?', o: ['Vẽ thêm chi tiết cho sơ đồ tổng thể', 'Lướt nhanh cả 3 điểm nóng, mỗi điểm 2 phút', 'Chuyển sang hỏi ngược interviewer', 'Nói rõ "với 5 phút còn lại tôi chọn đào sâu X vì là rủi ro lớn nhất" rồi làm một điểm có chiều sâu'], a: 3, why: 'Một deep dive có trade-off và failure mode cho nhiều tín hiệu hơn ba điểm nông; quản lý giờ công khai cũng là tín hiệu senior.' },
    { t: 'mc', q: 'Interviewer hỏi về một công nghệ bạn chưa dùng production. Cách trả lời tốt nhất?', o: ['Nói đã dùng và trả lời chung chung', 'Thừa nhận chưa dùng, suy luận từ hệ thống tương tự đã dùng, nêu cách kiểm chứng', 'Từ chối trả lời và chuyển chủ đề', 'Nói đó không quan trọng với thiết kế này'], a: 1, why: 'Khung thừa nhận → nguyên lý gần nhất → cách kiểm chứng giữ uy tín và vẫn thể hiện tư duy.' },
    { t: 'mc', q: 'Hành vi nào là red flag rõ nhất trong 5 phút đầu?', o: ['Nhảy thẳng vào chọn Kafka và Cassandra trước khi hỏi quy mô', 'Hỏi tỉ lệ đọc/ghi', 'Ghi yêu cầu lên whiteboard', 'Hỏi điều gì ngoài phạm vi'], a: 0, why: 'Giải pháp trước yêu cầu cho thấy không ước lượng và dễ over-engineering.' },
    { t: 'mc', q: 'Interviewer chỉ ra một sự thật kỹ thuật bạn nói sai. Phản ứng senior?', o: ['Bảo vệ quan điểm để thể hiện tự tin', 'Im lặng và tiếp tục', 'Cảm ơn, sửa ngay, nêu lựa chọn thiết kế thay đổi thế nào theo thông tin mới', 'Chuyển sang chủ đề khác'], a: 2, why: 'Tách sự thật khỏi lựa chọn: sai sự thật thì sửa ngay; thể hiện khả năng cập nhật quyết định theo dữ liệu mới.' },
    { t: 'mc', q: 'Mục đích chính của câu "To summarize the requirements: ... Did I miss anything?" ở cuối pha làm rõ?', o: ['Kéo dài thời gian', 'Checkpoint để hai bên cùng một hiểu biết trước khi thiết kế, tránh thiết kế sai đề', 'Thể hiện tiếng Anh', 'Chuyển trách nhiệm sang interviewer'], a: 1, why: 'Checkpoint sau mỗi pha là kỹ thuật dẫn dắt cốt lõi; sai đề ở phút 5 rẻ hơn ở phút 30.' },
    { t: 'fill', q: 'Điền: quy tắc dẫn dắt — không im lặng quá ___ giây; cần nghĩ thì nói "give me 20 seconds".', a: ['30', 'ba mươi', '30 giây'], why: 'Im lặng dài làm interviewer không chấm được quá trình; nói to suy nghĩ là một phần bài thi.' },
    { t: 'fill', q: 'Điền câu khung khi không biết: "I haven\'t used X in ___, but based on Y I\'d expect Z; I\'d validate with a load test."', a: ['production', 'prod'], why: 'Thừa nhận trung thực + suy luận từ kinh nghiệm thật + cách kiểm chứng.' },
    { t: 'open', q: 'Đề: "Design a notification system for a multi-tenant SaaS" trong 45 phút. Viết kế hoạch 5 pha của bạn (mỗi pha 1–2 câu: làm gì, hỏi gì, đầu ra), kèm 2 điểm nóng bạn sẽ chủ động đề xuất đào sâu.', a: 'Phút 0–5 làm rõ: kênh (email, in-app, webhook), ai gửi (hệ thống, lịch), yêu cầu thứ tự/trùng, độ trễ chấp nhận, cách ly tenant, ngoài phạm vi (template editor, analytics); tóm tắt và xác nhận. Phút 5–10 ước lượng: số tenant, sự kiện/ngày → QPS trung bình và đỉnh, kích thước message, retention; kết luận queue cần hay không. Phút 10–22 HLD: producer → outbox trong DB nghiệp vụ → relay → queue theo kênh → worker gửi → trạng thái delivery; API đăng ký preference; data model notification, delivery_attempt. Phút 22–40 đào sâu hai điểm tôi tự đề xuất: (1) đảm bảo không mất và không trùng: outbox + at-least-once + idempotency key ở provider, retry backoff, DLQ; (2) rate limit per tenant và provider, bulkhead để tenant lớn không làm đói tenant nhỏ, dead provider → circuit breaker. Phút 40–45 kết: trade-off độ trễ 1 s của outbox đổi lấy không mất event, metric time-since-last-delivery, alert, giới hạn single region, hỏi feedback.', keys: ['outbox', 'idempotency', 'rate limit', 'tenant', 'trade-off'] }
  ]
}
];
