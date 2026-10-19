/* ===== LABS: 12 bài thực hành Go — mỗi bài 2–4 giờ, gắn với tuần học và sự cố thật ===== */
window.LABS = [
{ id: 'L1', week: 2, title: 'Đo latency trên máy bạn', time: '3 giờ',
  goal: 'Tự đo được latency RAM/map, SSD, Redis, Postgres, HTTP local bằng Go và lập bảng so với "latency numbers" để có cảm giác số liệu thật.',
  stack: 'Go 1.22, Redis 7, Postgres 16 (docker compose), go-redis v9, pgx v5',
  steps: [
`### Bước 1 — Dựng Redis + Postgres bằng docker compose
Tạo [[docker-compose.yml]] tối giản, map port ra localhost:
~~~yaml
services:
  redis:
    image: redis:7.2
    ports: ["6379:6379"]
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: lab
    ports: ["5432:5432"]
~~~
Chạy [[docker compose up -d]]. Pin version image (không dùng latest) — thói quen từ sự cố mongo:latest vỡ kernel host.`,
`### Bước 2 — Hàm đo percentile dùng chung
Mọi phép đo lặp N lần, lưu từng duration, tính p50/p99 (không lấy trung bình):
~~~go
func pct(d []time.Duration, p float64) time.Duration {
    sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
    return d[int(float64(len(d)-1)*p)]
}

func measure(name string, n int, fn func()) {
    ds := make([]time.Duration, 0, n)
    for i := 0; i < n; i++ {
        t := time.Now()
        fn()
        ds = append(ds, time.Since(t))
    }
    fmt.Printf("%-24s p50=%-10v p99=%-10v\n", name, pct(ds, 0.5), pct(ds, 0.99))
}
~~~
Nhớ warm-up 100 lần trước khi đo để bỏ qua cold cache và JIT của OS page cache.`,
`### Bước 3 — RAM: đọc mảng tuần tự vs map lookup ngẫu nhiên
~~~go
arr := make([]int64, 1<<20) // 8 MB
m := make(map[int64]int64, 1<<20)
for i := range arr { arr[i] = int64(i); m[int64(i)] = int64(i) }

var sink int64
measure("ram seq 1MB", 200, func() {
    for i := 0; i < 1<<17; i++ { sink += arr[i] } // 128k × 8 B = 1 MB
})
measure("map lookup x1000", 200, func() {
    for i := 0; i < 1000; i++ { sink += m[int64(rand.Intn(1<<20))] }
})
~~~
Chia kết quả cho số phần tử để ra ns/phần tử. Kỳ vọng: đọc tuần tự vài chục µs cho 1 MB; map lookup ~50–150 ns/lần (cache miss RAM ~100 ns).`,
`### Bước 4 — SSD: đọc ngẫu nhiên 4 KB từ file 1 GB
Tạo file 1 GB bằng [[fallocate -l 1G big.bin]] (Linux) hoặc ghi bằng Go. Mở với [[os.Open]], đọc bằng [[ReadAt]] ở offset ngẫu nhiên:
~~~go
f, _ := os.Open("big.bin")
buf := make([]byte, 4096)
measure("ssd random 4KB", 2000, func() {
    off := rand.Int63n(1<<30 - 4096)
    f.ReadAt(buf, off)
})
~~~
Lần đầu đo sẽ ra số thật (~100 µs SATA, ~20–50 µs NVMe). Chạy lần 2 số sẽ giảm mạnh vì OS page cache — ghi lại cả 2 số và giải thích vì sao.`,
`### Bước 5 — Redis: PING và GET
~~~go
rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
ctx := context.Background()
rdb.Set(ctx, "k", "v", 0)
measure("redis GET", 2000, func() { rdb.Get(ctx, "k").Result() })
measure("redis PIPELINE 100", 200, func() {
    p := rdb.Pipeline()
    for i := 0; i < 100; i++ { p.Get(ctx, "k") }
    p.Exec(ctx)
})
~~~
So sánh: 1 GET lẻ vs 100 GET pipeline chia 100 → thấy phần lớn chi phí là round trip, không phải Redis xử lý.`,
`### Bước 6 — Postgres: SELECT 1 và SELECT theo khóa chính
~~~go
pool, _ := pgxpool.New(ctx, "postgres://postgres:lab@localhost:5432/postgres")
pool.Exec(ctx, "CREATE TABLE IF NOT EXISTS t(id int PRIMARY KEY, v text)")
pool.Exec(ctx, "INSERT INTO t SELECT g, md5(g::text) FROM generate_series(1,100000) g ON CONFLICT DO NOTHING")

var one int
measure("pg SELECT 1", 1000, func() { pool.QueryRow(ctx, "SELECT 1").Scan(&one) })
var v string
measure("pg SELECT by PK", 1000, func() {
    pool.QueryRow(ctx, "SELECT v FROM t WHERE id = $1", rand.Intn(100000)+1).Scan(&v)
})
measure("pg seq scan", 20, func() {
    pool.QueryRow(ctx, "SELECT count(*) FROM t WHERE v LIKE 'ab%'").Scan(&one)
})
~~~
Kỳ vọng: SELECT 1 ~100–300 µs (round trip + parse), PK lookup gần bằng, seq scan 100k dòng ~10–30 ms.`,
`### Bước 7 — HTTP local round trip
Dựng [[net/http]] server trả "ok" trên :8080 trong cùng process (goroutine) rồi đo client:
~~~go
client := &http.Client{Timeout: 2 * time.Second}
measure("http local GET", 1000, func() {
    resp, err := client.Get("http://localhost:8080/ok")
    if err == nil { io.Copy(io.Discard, resp.Body); resp.Body.Close() }
})
~~~
Quan trọng: đọc hết body và Close để tái dùng kết nối keep-alive. Thử bỏ dòng Close và xem p99 đổi thế nào (mỗi request mở TCP mới).`,
`### Bước 8 — Lập bảng và so với số chuẩn
Điền bảng 3 cột: phép đo | số bạn đo (p50) | số "latency numbers" tham chiếu. Ghi tỉ lệ chênh và nguyên nhân (máy ảo, Docker Desktop qua VM, page cache, NVMe). Lưu bảng này vào ghi chú tuần 2 — bạn sẽ dùng nó khi ước lượng trong mock interview.`
  ],
  accept: [
    'Có bảng ít nhất 8 phép đo với p50 và p99, mỗi phép đo ≥ 200 mẫu (SSD ≥ 2000).',
    'Redis GET lẻ và GET qua pipeline/100 chênh nhau ≥ 10 lần.',
    'SSD random 4 KB lần đầu (cold) và lần sau (page cache) đều được ghi lại, kèm giải thích.',
    'Postgres SELECT by PK < 1 ms p50; seq scan 100k dòng được đo riêng và lớn hơn PK lookup ≥ 20 lần.',
    'Bỏ resp.Body.Close() làm p99 HTTP tăng rõ rệt và bạn giải thích được vì sao.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Phần lớn latency của Redis/Postgres local là **round trip + syscall**, không phải "DB chậm": pipeline 100 lệnh chỉ tốn gấp 2–3 lần 1 lệnh. Khi nào trong code thật bạn đang gọi 100 GET lẻ trong vòng lặp (N+1)?
- Số bạn đo trên Docker Desktop (Windows/macOS) đi qua VM nên RTT ~0,3–1 ms, cao hơn Linux native. Ghi rõ môi trường khi báo số.
- SSD lần 2 nhanh gấp 10–100 lần lần 1: đó là page cache của OS, không phải đĩa. Benchmark DB mà không để ý cold/warm là tự lừa mình.
- Câu tự vấn: nếu một request API gọi 1 Redis + 3 query Postgres nối tiếp + 1 HTTP ngoài 50 ms, p50 tối thiểu là bao nhiêu? Có cái nào song song được không?
- Liên hệ hệ thống SBOM: enrichment gọi ClearlyDefined theo batch thay vì từng coordinate chính là bài học pipeline này; và export ReadAll vào RAM (sự cố #11) tốn đúng chi phí "đọc tuần tự 1 MB" × số MB.
- Ghi lại 3 con số bạn sẽ nhớ nằm lòng: RTT local, PK lookup, SSD random.`
},
{ id: 'L2', week: 3, title: 'Connection pool & timeout với pgx', time: '3 giờ',
  goal: 'Tái hiện pool exhaustion, thấy rõ statement_timeout ở session/SET LOCAL/role khác nhau thế nào, dùng lock_timeout và đọc pg_stat_activity như một senior.',
  stack: 'Go 1.22, Postgres 16 (docker), pgx v5 + pgxpool, psql',
  steps: [
`### Bước 1 — Pool nhỏ có chủ đích
~~~go
cfg, _ := pgxpool.ParseConfig("postgres://postgres:lab@localhost:5432/postgres")
cfg.MaxConns = 5
cfg.MinConns = 1
cfg.MaxConnLifetime = 30 * time.Minute
cfg.MaxConnIdleTime = 5 * time.Minute
pool, err := pgxpool.NewWithConfig(ctx, cfg)
if err != nil { log.Fatal(err) }
~~~
Ghi chú vì sao MaxConns = 5: Postgres mặc định max_connections = 100, mỗi kết nối ~5–10 MB. Tổng pool của mọi instance phải nhỏ hơn con số đó.`,
`### Bước 2 — Tái hiện pool exhaustion
Chạy 20 goroutine, mỗi goroutine [[SELECT pg_sleep(2)]]. Đo thời gian chờ Acquire:
~~~go
var wg sync.WaitGroup
for i := 0; i < 20; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        t := time.Now()
        c, err := pool.Acquire(ctx)
        if err != nil { log.Println("acquire:", err); return }
        wait := time.Since(t)
        c.Exec(ctx, "SELECT pg_sleep(2)")
        c.Release()
        log.Printf("g%02d waited %v", i, wait)
    }(i)
}
wg.Wait()
fmt.Printf("%+v\n", pool.Stat())
~~~
Kỳ vọng: 5 goroutine đầu chờ ~0, nhóm sau chờ ~2 s, ~4 s, ~6 s. Đọc [[pool.Stat().EmptyAcquireCount]] và [[AcquireDuration]].`,
`### Bước 3 — Acquire có deadline
Thêm [[ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)]] trước Acquire. Lúc này 15 goroutine phải nhận lỗi [[context deadline exceeded]] thay vì chờ 6 s. Hỏi: API của bạn muốn trả 503 nhanh (fail fast, load shedding) hay để request xếp hàng? Viết câu trả lời vào ghi chú.`,
`### Bước 4 — statement_timeout ở 3 cấp
Mở psql: [[ALTER ROLE postgres SET statement_timeout = '3s';]] rồi kết nối lại pool (giá trị role chỉ áp cho kết nối mới). Chạy 3 thí nghiệm, mỗi cái [[SELECT pg_sleep(5)]]:
~~~go
// A: ngoài transaction, không set gì → dính 3s của ROLE
_, errA := pool.Exec(ctx, "SELECT pg_sleep(5)")

// B: SET LOCAL trong tx → 10s chỉ sống trong tx này
tx, _ := pool.Begin(ctx)
tx.Exec(ctx, "SET LOCAL statement_timeout = '10s'")
_, errB := tx.Exec(ctx, "SELECT pg_sleep(5)")
tx.Commit(ctx)

// C: query tiếp theo trên CÙNG kết nối, ngoài tx → lại dính 3s
c, _ := pool.Acquire(ctx)
_, errC := c.Exec(ctx, "SELECT pg_sleep(5)")
c.Release()
fmt.Println("A:", errA, "B:", errB, "C:", errC)
~~~
Kỳ vọng: A lỗi 57014 (canceling statement due to statement timeout), B thành công, C lỗi. Đây chính là sự cố #4: code chỉ SET LOCAL trong tx nên query ngoài tx vẫn bị role 90 s giết.`,
`### Bước 5 — SET ở cấp session và cái bẫy pool
Thử [[c.Exec(ctx, "SET statement_timeout = '10s'")]] (không LOCAL) rồi Release. Kết nối đó quay về pool mang theo setting 10 s; goroutine khác Acquire trúng nó sẽ có hành vi khác goroutine Acquire kết nối khác. Chứng minh bằng cách lặp Acquire 10 lần và in [[SHOW statement_timeout]]. Kết luận: với pool, chỉ dùng SET LOCAL trong tx hoặc đặt trong [[AfterConnect]] cho đồng nhất.`,
`### Bước 6 — lock_timeout và deadlock nhỏ
Terminal 1 (psql): [[BEGIN; SELECT * FROM t WHERE id = 1 FOR UPDATE;]] và để đó. Trong Go:
~~~go
tx, _ := pool.Begin(ctx)
tx.Exec(ctx, "SET LOCAL lock_timeout = '1s'")
_, err := tx.Exec(ctx, "UPDATE t SET v = 'x' WHERE id = 1")
fmt.Println(err) // SQLSTATE 55P03 lock_not_available sau đúng 1 s
tx.Rollback(ctx)
~~~
Không có lock_timeout, UPDATE sẽ treo vô hạn và chiếm 1 slot pool — nhân lên 5 request là pool cạn. Ghi lại SQLSTATE để code phân biệt với timeout thường.`,
`### Bước 7 — Đọc pg_stat_activity như bảng điều khiển
Trong khi bước 2 và 6 đang chạy, ở psql:
~~~sql
SELECT pid, state, wait_event_type, wait_event,
       now() - xact_start AS tx_age, now() - query_start AS q_age,
       left(query, 60) AS q
FROM pg_stat_activity
WHERE datname = 'postgres' AND pid <> pg_backend_pid()
ORDER BY xact_start;
~~~
Nhận diện: [[active]] + wait_event Lock = đang chờ lock; [[idle in transaction]] = app mở tx rồi làm việc khác (nguy hiểm). Thử đặt [[SET idle_in_transaction_session_timeout = '5s']] và mô phỏng quên commit.`,
`### Bước 8 — Metric pool ra Prometheus (tùy chọn)
Expose [[pool.Stat()]] thành gauge: total_conns, idle_conns, acquire_count, empty_acquire_count. Nhìn empty_acquire_count tăng là dấu hiệu pool nhỏ hoặc query chậm — đây là metric bạn nên có trên apiserver thật.`
  ],
  accept: [
    'Log bước 2 cho thấy thời gian chờ Acquire phân tầng ~0 / ~2 s / ~4 s / ~6 s với MaxConns = 5 và 20 goroutine.',
    'Với Acquire có deadline 500 ms, ≥ 10 goroutine nhận context deadline exceeded trong < 1 s.',
    'Ba thí nghiệm A/B/C ở bước 4 cho kết quả đúng kỳ vọng: A lỗi 57014, B thành công, C lỗi 57014; bạn viết được 2 câu giải thích.',
    'UPDATE với lock_timeout 1 s trả SQLSTATE 55P03 trong 1,0–1,2 s khi row bị FOR UPDATE ở session khác.',
    'Chụp/ghi lại output pg_stat_activity có ít nhất 1 dòng wait_event Lock và 1 dòng idle in transaction.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Pool exhaustion không sinh lỗi, nó sinh **chờ**: p99 API tăng vọt mà DB vẫn rảnh. Metric nào trong hệ thống bạn hiện cho thấy điều này? (Nếu không có: empty_acquire_count là việc đầu tuần.)
- Cùng một câu SQL có thể bị giết hay không tùy nó nằm trong tx hay không và tùy kết nối trúng setting gì — đây là lý do sự cố #4 khó debug: lỗi xuất hiện "ngẫu nhiên" theo kết nối.
- Timeout ở role là "quyết định ngầm" của người khác (DBA, Aurora). Việc đầu tiên khi vào môi trường mới: [[SELECT rolname, rolconfig FROM pg_roles;]] và [[SHOW statement_timeout;]].
- Câu tự vấn: bạn muốn statement_timeout mặc định bao nhiêu cho API (ví dụ 5 s), cho worker (60 s), cho migration (0)? Đặt ở đâu để không lệ thuộc role?
- idle in transaction giữ lock và chặn VACUUM; một tx mở rồi gọi HTTP ngoài 30 s là dạng lỗi này. Soi code: có chỗ nào gọi ClearlyDefined/OSV bên trong transaction không?
- Lambda (sự cố #4, ticket statement_timeout) không có pool bền và chạy qua nhiều kết nối ngắn: SET session là vô nghĩa, chỉ SET LOCAL hoặc tham số kết nối [[options=-c statement_timeout=...]] mới tin được.`
},
{ id: 'L3', week: 4, title: 'Cache-aside Redis + chống stampede', time: '3 giờ',
  goal: 'Cài cache-aside đúng, tái hiện cache stampede với 1000 request đồng thời miss, rồi đưa DB hit về 1 bằng singleflight + lock Redis + TTL jitter và đo p99.',
  stack: 'Go 1.22, Redis 7, Postgres 16, go-redis v9, golang.org/x/sync/singleflight, hey hoặc k6',
  steps: [
`### Bước 1 — Nguồn dữ liệu "chậm" có đếm
Bảng [[products(id, name, price)]] 10k dòng. Hàm đọc DB cố tình chậm 50 ms và đếm số lần gọi (atomic) để chứng minh stampede:
~~~go
var dbHits atomic.Int64

func loadFromDB(ctx context.Context, id int) (Product, error) {
    dbHits.Add(1)
    var p Product
    err := pool.QueryRow(ctx,
        "SELECT id, name, price, pg_sleep(0.05) FROM products WHERE id = $1", id).
        Scan(&p.ID, &p.Name, &p.Price, nil)
    return p, err
}
~~~
Expose [[/metrics-lite]] trả dbHits để đọc nhanh bằng curl.`,
`### Bước 2 — Cache-aside ngây thơ
~~~go
func getProduct(ctx context.Context, id int) (Product, error) {
    key := fmt.Sprintf("product:%d", id)
    if s, err := rdb.Get(ctx, key).Result(); err == nil {
        var p Product
        json.Unmarshal([]byte(s), &p)
        return p, nil
    }
    p, err := loadFromDB(ctx, id)
    if err != nil { return p, err }
    b, _ := json.Marshal(p)
    rdb.Set(ctx, key, b, 60*time.Second)
    return p, nil
}
~~~
Handler [[GET /products/{id}]] gọi hàm này. Xóa key, bắn [[hey -n 1000 -c 1000 http://localhost:8080/products/42]]. Đọc dbHits: kỳ vọng ~1000 (mọi request đều miss cùng lúc) và DB chịu 1000 query 50 ms.`,
`### Bước 3 — singleflight trong process
~~~go
var g singleflight.Group

func getProductSF(ctx context.Context, id int) (Product, error) {
    key := fmt.Sprintf("product:%d", id)
    if s, err := rdb.Get(ctx, key).Result(); err == nil { var p Product; json.Unmarshal([]byte(s), &p); return p, nil }
    v, err, shared := g.Do(key, func() (any, error) {
        p, err := loadFromDB(ctx, id)
        if err == nil { b, _ := json.Marshal(p); rdb.Set(ctx, key, b, 60*time.Second) }
        return p, err
    })
    _ = shared
    if err != nil { return Product{}, err }
    return v.(Product), nil
}
~~~
Lặp lại hey. dbHits phải ≈ 1. Lưu ý: ctx bên trong Do là ctx của request đầu tiên — nếu request đó bị cancel, mọi người chờ cùng nhận lỗi. Dùng [[context.WithoutCancel]] (Go 1.21+) cho lời gọi DB.`,
`### Bước 4 — Hai instance: singleflight không đủ
Chạy 2 process API trên :8080 và :8081 sau một nginx/hoặc bắn hey vào cả hai. dbHits tổng ≈ 2 (mỗi process 1). Với 20 instance là 20 query — chấp nhận được, nhưng với query 5 s thì không. Thêm lock Redis:
~~~go
lockKey := key + ":lock"
ok, _ := rdb.SetNX(ctx, lockKey, "1", 5*time.Second).Result()
if !ok {
    // người khác đang nạp: chờ ngắn rồi đọc lại cache (tối đa vài lần)
    time.Sleep(50 * time.Millisecond)
    return getProduct(ctx, id)
}
defer rdb.Del(ctx, lockKey)
~~~
Ghi chú: lock này là best-effort (không fencing), chỉ để giảm tải, không để bảo vệ tính đúng.`,
`### Bước 5 — TTL jitter và stale-while-revalidate
Hàng nghìn key được warm cùng lúc sẽ hết hạn cùng lúc. Thay TTL cố định bằng [[60s + rand(0..12s)]]. Nâng cao: lưu kèm [[expires_at]] logic nhỏ hơn TTL thật 10 s; khi đọc thấy sắp hết hạn thì trả giá trị cũ ngay và nạp lại nền trong goroutine (dùng singleflight để chỉ 1 goroutine nạp).`,
`### Bước 6 — Đo p50/p99 từng phương án
Chạy hey 1000/1000 cho 3 phiên bản (ngây thơ, singleflight, singleflight + lock Redis + SWR) sau khi xóa key. Lập bảng: dbHits | p50 | p99 | lỗi. Kỳ vọng ngây thơ p99 ≥ 1 s (DB xếp hàng), singleflight p99 ≈ 60–100 ms.`,
`### Bước 7 — Invalidation
Thêm [[PUT /products/{id}]]: cập nhật DB rồi [[DEL]] key (không SET giá trị mới — tránh race ghi cũ đè mới). Viết test: 2 goroutine cùng update + đọc, kiểm tra cache không giữ giá trị cũ quá TTL. Ghi lại vì sao "delete thay vì update cache" là mặc định an toàn.`
  ],
  accept: [
    'Phiên bản ngây thơ: 1000 request đồng thời sau khi xóa key cho dbHits ≥ 500.',
    'Phiên bản singleflight 1 instance: dbHits = 1 (hoặc ≤ 3) cho cùng kịch bản.',
    'Hai instance + lock Redis: dbHits ≤ 2 và không request nào lỗi/timeout.',
    'Bảng so sánh p50/p99 của 3 phương án, p99 của phương án cuối < 150 ms với DB giả chậm 50 ms.',
    'TTL có jitter: kiểm tra TTL của 100 key bằng lệnh TTL thấy phân bố trong khoảng 60–72 s, không trùng nhau.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Stampede không phải lỗi logic mà là lỗi **thời điểm**: code đúng 100% vẫn làm sập DB. Mọi cache có TTL đều có khoảnh khắc này — câu hỏi chỉ là bao nhiêu request trúng vào đó.
- singleflight gom theo process; lock Redis gom theo cụm; SWR xóa luôn khoảnh khắc miss. Ba tầng này không thay thế nhau.
- Quan sát Redis bằng [[redis-cli --stat]] hoặc [[INFO stats]] (keyspace_hits/misses) trong lúc chạy hey — hit ratio là metric phải có trên dashboard thật.
- Câu tự vấn: cache của bạn fail-open hay fail-closed? Khi Redis chết, API đi thẳng DB (và DB chịu được không?) hay trả lỗi?
- Liên hệ SBOM: Lambda enrichment mất REDIS_HOST (sự cố #2) nghĩa là cache L1 biến mất âm thầm → mọi call đi thẳng ClearlyDefined và dính rate limit. Metric cache hit ratio = 0 lẽ ra phải kêu ngay.
- Ghi chú ADR 5 dòng: key naming, TTL + jitter, chiến lược invalidation (delete), quyết định fail-open.`
},
{ id: 'L4', week: 5, title: 'Idempotent consumer RabbitMQ + DLQ + publisher reconnect', time: '4 giờ',
  goal: 'Dựng publisher có confirm và tự reconnect, consumer idempotent bằng dedup table, DLX cho message hỏng; kill broker giữa chừng và chứng minh không mất message, không xử lý trùng.',
  stack: 'Go 1.22, RabbitMQ 3.13 (docker), github.com/rabbitmq/amqp091-go, Postgres 16, pgx v5',
  steps: [
`### Bước 1 — Topology có DLX
Dùng [[rabbitmq:3.13-management]] (port 5672, 15672). Khai báo khi khởi động (idempotent):
~~~go
ch.ExchangeDeclare("orders", "topic", true, false, false, false, nil)
ch.ExchangeDeclare("orders.dlx", "topic", true, false, false, false, nil)
ch.QueueDeclare("orders.dlq", true, false, false, false, nil)
ch.QueueBind("orders.dlq", "#", "orders.dlx", false, nil)
args := amqp.Table{"x-dead-letter-exchange": "orders.dlx"}
ch.QueueDeclare("orders.process", true, false, false, false, args)
ch.QueueBind("orders.process", "order.*", "orders", false, nil)
~~~
Queue durable + message persistent (DeliveryMode 2) để sống qua restart broker.`,
`### Bước 2 — Publisher ngây thơ (để thấy nó chết)
Tạo 1 connection + 1 channel lúc start, lưu vào struct singleton, publish mỗi giây một message có [[MessageId = uuid]]. Chạy, rồi [[docker restart rabbitmq]]. Quan sát: Publish trả lỗi "channel/connection is not open" mãi mãi, hoặc tệ hơn — nếu code bỏ qua err thì log im lặng. Đây chính là sự cố #1: cron im lặng nhiều ngày vì publisher singleton không reconnect.`,
`### Bước 3 — Publisher có reconnect + confirm
~~~go
type Publisher struct {
    mu   sync.Mutex
    conn *amqp.Connection
    ch   *amqp.Channel
    url  string
}

func (p *Publisher) connect() error {
    conn, err := amqp.Dial(p.url)
    if err != nil { return err }
    ch, err := conn.Channel()
    if err != nil { conn.Close(); return err }
    if err := ch.Confirm(false); err != nil { return err }
    p.conn, p.ch = conn, ch
    go func() {
        e := <-conn.NotifyClose(make(chan *amqp.Error, 1))
        log.Println("amqp closed:", e)
        p.mu.Lock(); p.conn, p.ch = nil, nil; p.mu.Unlock()
    }()
    return nil
}

func (p *Publisher) Publish(ctx context.Context, key string, body []byte, id string) error {
    for attempt := 0; attempt < 5; attempt++ {
        p.mu.Lock()
        if p.ch == nil {
            if err := p.connect(); err != nil { p.mu.Unlock(); time.Sleep(backoff(attempt)); continue }
        }
        ch := p.ch
        p.mu.Unlock()
        conf, err := ch.PublishWithDeferredConfirmWithContext(ctx, "orders", key, true, false,
            amqp.Publishing{MessageId: id, DeliveryMode: 2, Body: body})
        if err == nil && conf.Wait() { lastPublishOK.Store(time.Now().Unix()); return nil }
        time.Sleep(backoff(attempt))
    }
    return errors.New("publish failed after retries")
}
~~~
[[backoff(n)]] = 200 ms × 2^n + jitter. [[lastPublishOK]] là gauge Prometheus "publish_last_success_timestamp".`,
`### Bước 4 — Consumer idempotent bằng dedup table
~~~sql
CREATE TABLE processed_messages (
  message_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
~~~
~~~go
func handle(ctx context.Context, d amqp.Delivery) error {
    tx, err := pool.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)
    tag, err := tx.Exec(ctx,
        "INSERT INTO processed_messages(message_id) VALUES ($1) ON CONFLICT DO NOTHING", d.MessageId)
    if err != nil { return err }
    if tag.RowsAffected() == 0 { return nil } // đã xử lý → ack, bỏ qua
    if err := applyOrder(ctx, tx, d.Body); err != nil { return err }
    return tx.Commit(ctx)
}
~~~
Dedup và nghiệp vụ nằm trong CÙNG transaction — nếu commit fail thì dedup cũng rollback, message sẽ được xử lý lại.`,
`### Bước 5 — Ack/Nack và phân loại lỗi
~~~go
msgs, _ := ch.Consume("orders.process", "worker-1", false, false, false, false, nil)
ch.Qos(20, 0, false) // prefetch = backpressure
for d := range msgs {
    err := handle(ctx, d)
    switch {
    case err == nil:
        d.Ack(false)
    case isPermanent(err): // JSON hỏng, order không tồn tại...
        d.Nack(false, false) // requeue=false → đi DLX
    default: // DB tạm chết, timeout
        time.Sleep(time.Second)
        d.Nack(false, true) // requeue
    }
}
~~~
Gửi 1 message body "not json" → phải thấy nó trong [[orders.dlq]] trên UI :15672 với header x-death.`,
`### Bước 6 — Chaos: kill broker trong lúc publish 1000 message
Publisher gửi 1000 message id tăng dần, mỗi 10 ms. Ở giây thứ 3: [[docker restart rabbitmq]] (hoặc [[docker rm -f]] rồi [[up]] để tái hiện "recreate"). Kỳ vọng: publisher log reconnect, không mất message (đếm processed_messages = 1000 sau khi xong), có thể có message publish 2 lần nhưng consumer chỉ xử lý 1 lần.`,
`### Bước 7 — Chaos: kill consumer giữa transaction
Thêm [[time.Sleep(2s)]] trong applyOrder và [[kill -9]] consumer khi đang xử lý. Message chưa ack sẽ redeliver cho consumer mới ([[d.Redelivered = true]]). Dedup insert rollback nên lần 2 xử lý bình thường. Kiểm tra không có order trùng.`,
`### Bước 8 — Health check và alert "im lặng"
[[/healthz]] trả 503 nếu [[p.ch == nil]] hoặc [[now − publish_last_success > 5 phút]] (khi có việc để publish). Viết alert rule Prometheus: [[time() - publish_last_success_timestamp > 300]]. Đây là thứ lẽ ra bắt được sự cố #1 trong 5 phút thay vì nhiều ngày.`
  ],
  accept: [
    'Publisher ngây thơ sau docker restart rabbitmq không gửi được nữa (log lỗi liên tục hoặc im lặng) — ghi lại hiện tượng.',
    'Publisher mới tự nối lại trong < 10 s sau restart; 1000 message gửi trong lúc có restart đều được xử lý: count(processed_messages) = 1000.',
    'Gửi cùng message_id 3 lần → applyOrder chỉ chạy 1 lần; không có order trùng.',
    'Message hỏng (body không parse được) nằm trong orders.dlq với header x-death, queue chính không bị chặn.',
    'kill -9 consumer giữa chừng → message redelivered và xử lý thành công ở consumer khác, không duplicate.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Lỗi nguy hiểm nhất không phải lỗi có log mà là **không có gì xảy ra**: publisher chết im, cron vẫn "chạy", dashboard vẫn xanh. Alert phải dựa trên "lần thành công cuối", không dựa trên số lỗi.
- Publisher confirm không miễn phí: đo throughput khi bật/tắt confirm. Chấp nhận chậm hơn để không mất message là quyết định có ý thức.
- Dedup table phình vô hạn: cần TTL/purge (xóa message cũ hơn 7 ngày) hoặc Redis SETNX với TTL (nhanh hơn nhưng không cùng tx với nghiệp vụ — chấp nhận cửa sổ nhỏ).
- prefetch (Qos) là backpressure: prefetch quá cao + consumer chậm = RAM phình; quá thấp = throughput kém. Thử 1, 20, 200 và xem.
- Câu tự vấn: hệ thống SBOM của bạn có bao nhiêu publisher singleton? Có cái nào lắng NotifyClose không? Audit log publish trước commit (sự cố #12) sẽ được chữa ở L6 bằng outbox.
- Watchtower recreate container khác restart ở chỗ IP/identity đổi — nhiều client chỉ reconnect được khi broker restart, không khi recreate. Thử cả hai.`
},
{ id: 'L5', week: 7, title: 'Consistent hashing ring', time: '2,5 giờ',
  goal: 'Tự cài vòng consistent hashing có virtual node, đo % key di chuyển khi thêm/bớt node và độ lệch phân bố theo số virtual node, so với hash mod N.',
  stack: 'Go 1.22, testing/benchmark, hash/fnv hoặc xxhash',
  steps: [
`### Bước 1 — Baseline: hash mod N
~~~go
func modNode(key string, n int) int {
    h := fnv.New32a(); h.Write([]byte(key))
    return int(h.Sum32() % uint32(n))
}
~~~
Sinh 1 triệu key [[fmt.Sprintf("tenant-%d/component-%d", ...)]]. Gán cho 10 node, rồi 11 node; đếm số key đổi node. Kỳ vọng ~90% key di chuyển — lý do mod N không dùng được cho cache cluster.`,
`### Bước 2 — Cấu trúc ring
~~~go
type Ring struct {
    vnodes  int
    hashes  []uint32          // sorted
    owner   map[uint32]string // hash → node
    nodes   map[string]struct{}
}

func hash32(s string) uint32 { h := fnv.New32a(); h.Write([]byte(s)); return h.Sum32() }

func (r *Ring) Add(node string) {
    r.nodes[node] = struct{}{}
    for i := 0; i < r.vnodes; i++ {
        h := hash32(fmt.Sprintf("%s#%d", node, i))
        r.owner[h] = node
        r.hashes = append(r.hashes, h)
    }
    sort.Slice(r.hashes, func(i, j int) bool { return r.hashes[i] < r.hashes[j] })
}
~~~
Mỗi node đặt [[vnodes]] điểm lên vòng. Dùng [[sort.Search]] để tìm điểm đầu tiên ≥ hash(key); hết vòng thì quay về index 0.`,
`### Bước 3 — Lookup và Remove
~~~go
func (r *Ring) Get(key string) string {
    if len(r.hashes) == 0 { return "" }
    h := hash32(key)
    i := sort.Search(len(r.hashes), func(i int) bool { return r.hashes[i] >= h })
    if i == len(r.hashes) { i = 0 }
    return r.owner[r.hashes[i]]
}

func (r *Ring) Remove(node string) {
    delete(r.nodes, node)
    kept := r.hashes[:0]
    for _, h := range r.hashes {
        if r.owner[h] == node { delete(r.owner, h); continue }
        kept = append(kept, h)
    }
    r.hashes = kept
}
~~~
Viết test: Get ổn định (cùng key → cùng node), Remove node thì key chỉ đi sang node kế tiếp trên vòng.`,
`### Bước 4 — Đo % key di chuyển
Với 10 node, vnodes = 100: gán 1M key, thêm node thứ 11, đếm key đổi chủ. Kỳ vọng ≈ 1/11 ≈ 9%. Bớt 1 node: ≈ 10%. Lặp với vnodes = 1 và 1000 — tỉ lệ di chuyển không đổi nhiều, nhưng **ai** nhận key thì khác (bước 5).`,
`### Bước 5 — Phân bố và std dev theo vnodes
Đếm số key mỗi node, tính độ lệch chuẩn chia trung bình (coefficient of variation):
~~~go
func cv(counts map[string]int) float64 {
    n := float64(len(counts)); var sum, sq float64
    for _, c := range counts { sum += float64(c) }
    mean := sum / n
    for _, c := range counts { d := float64(c) - mean; sq += d * d }
    return math.Sqrt(sq/n) / mean
}
~~~
Bảng: vnodes = 1, 10, 50, 100, 200, 500 → CV. Kỳ vọng: vnodes = 1 lệch 50–100%; 100–200 còn ~5–10%; thêm nữa lợi ít mà tốn RAM/lookup.`,
`### Bước 6 — Benchmark lookup
[[go test -bench=Ring -benchmem]] cho Get với 10 node × 200 vnodes (2000 điểm). Kỳ vọng vài chục ns/op (binary search 11 bước + hash). So với map mod N: chậm hơn 2–3 lần nhưng vẫn không đáng kể so với 1 round trip mạng 500 µs.`,
`### Bước 7 — Hot node và weighted node
Cho node "big" vnodes gấp đôi → nhận gấp đôi key (weighted). Sau đó mô phỏng hot key: 30% request trúng 1 key → node sở hữu nó quá tải dù phân bố key đều. Kết luận: consistent hashing cân bằng **số key**, không cân bằng **tải**; hot key phải xử lý riêng (replicate key ra k node, cache cục bộ).`
  ],
  accept: [
    'Hash mod N: thêm node 10 → 11 làm ≥ 85% key đổi node; ring: ≤ 12% key đổi node.',
    'Bảng CV theo vnodes có ≥ 5 giá trị, CV giảm đơn điệu và < 10% khi vnodes ≥ 100.',
    'Test đơn vị: Get ổn định; sau Remove(node) mọi key của node đó chuyển sang đúng node kế tiếp trên vòng, key khác không đổi.',
    'Benchmark Get < 200 ns/op với 2000 điểm trên vòng, 0 alloc/op.',
    'Weighted node với vnodes ×2 nhận 1,8–2,2× số key so với node thường.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Con số đáng nhớ: ~1/N key di chuyển khi thêm 1 node (vs ~N−1/N với mod). Đây là câu trả lời phỏng vấn "vì sao cần consistent hashing cho cache/shard".
- Virtual node mua **đều** bằng RAM và thời gian lookup; 100–200 là điểm ngọt phổ biến (Cassandra mặc định 256 token/node cũ, 16 mới với thuật toán khác).
- Phân bố đều ≠ tải đều. Trong hệ thống SBOM, tenant có 200k component là "hot key" tự nhiên: sharding theo tenant_id sẽ dồn tải vào 1 shard; cần shard key phụ (tenant_id + sbom_id) hoặc tách tenant lớn ra riêng.
- Câu tự vấn: khi node rời vòng tạm thời (restart 30 s) bạn có muốn rebalance ngay không? Rebalance rồi node quay lại = key chạy đi chạy về 2 lần (cache miss ×2). Thực tế dùng "grace period" trước khi coi node là mất.
- Ring không có replication: để chịu lỗi, mỗi key thuộc node chủ + k−1 node kế tiếp (preference list của Dynamo). Thử mở rộng Get trả về 3 node khác nhau.
- Hash function: FNV đủ cho lab; production hay dùng xxhash/murmur3 vì phân bố tốt hơn và nhanh hơn với key dài.`
},
{ id: 'L6', week: 8, title: 'Outbox pattern Postgres + relay', time: '3,5 giờ',
  goal: 'Cài transactional outbox: ghi order và event cùng transaction, relay poll bằng SKIP LOCKED và publish at-least-once, consumer idempotent; chứng minh không mất và không "publish trước commit".',
  stack: 'Go 1.22, Postgres 16, RabbitMQ 3.13, pgx v5, amqp091-go',
  steps: [
`### Bước 1 — Tái hiện bug "publish trước commit" (sự cố #12)
Handler tạo order: [[BEGIN → INSERT orders → publish event → sleep 500 ms → COMMIT]]. Consumer nhận event và [[INSERT order_audits(order_id) REFERENCES orders]]. Chạy: consumer nhận FK violation vì order chưa commit; nếu consumer ack trước khi insert thì audit mất luôn. Ghi lại log lỗi làm bằng chứng.`,
`### Bước 2 — Bảng outbox
~~~sql
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  aggregate_id  text NOT NULL,
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
~~~
Partial index trên [[published_at IS NULL]]: outbox sẽ có hàng triệu dòng đã publish nhưng relay chỉ quan tâm vài trăm dòng chưa publish — cùng bài học partial index của sự cố #16.`,
`### Bước 3 — Ghi order + event trong cùng transaction
~~~go
func createOrder(ctx context.Context, o Order) error {
    tx, err := pool.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)
    if _, err := tx.Exec(ctx, "INSERT INTO orders(id, amount) VALUES ($1, $2)", o.ID, o.Amount); err != nil {
        return err
    }
    payload, _ := json.Marshal(map[string]any{"order_id": o.ID, "amount": o.Amount})
    if _, err := tx.Exec(ctx,
        "INSERT INTO outbox(aggregate_id, topic, payload) VALUES ($1, 'order.created', $2)",
        o.ID, payload); err != nil {
        return err
    }
    return tx.Commit(ctx)
}
~~~
Không còn gọi broker trong handler: handler chỉ phụ thuộc DB → nhanh hơn và không có dual-write.`,
`### Bước 4 — Relay poll với SKIP LOCKED
~~~go
func relayOnce(ctx context.Context) (int, error) {
    tx, err := pool.Begin(ctx)
    if err != nil { return 0, err }
    defer tx.Rollback(ctx)
    rows, err := tx.Query(ctx,
        "SELECT id, topic, payload FROM outbox WHERE published_at IS NULL "+
        "ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED")
    if err != nil { return 0, err }
    var ids []int64
    for rows.Next() {
        var id int64; var topic string; var payload []byte
        rows.Scan(&id, &topic, &payload)
        if err := pub.Publish(ctx, topic, payload, strconv.FormatInt(id, 10)); err != nil {
            break // dừng batch, dòng chưa publish sẽ được lấy lại lần sau
        }
        ids = append(ids, id)
    }
    rows.Close()
    if len(ids) > 0 {
        tx.Exec(ctx, "UPDATE outbox SET published_at = now() WHERE id = ANY($1)", ids)
    }
    return len(ids), tx.Commit(ctx)
}
~~~
Vòng lặp: poll mỗi 200 ms; nếu batch đầy 100 thì poll lại ngay (không sleep). MessageId = outbox.id để consumer dedup.`,
`### Bước 5 — Hai relay cùng chạy
Chạy 2 process relay. SKIP LOCKED đảm bảo 2 relay lấy 2 tập dòng khác nhau trong cùng thời điểm. Bắn 10k order bằng hey, đếm message consumer nhận theo MessageId: tổng unique = 10k. Có thể có duplicate (bước 6), không được thiếu.`,
`### Bước 6 — Chaos: kill relay sau publish, trước UPDATE
Thêm [[if os.Getenv("CHAOS") == "1" && rand.Intn(50) == 0 { os.Exit(1) }]] ngay sau Publish trong vòng lặp. Transaction rollback → published_at vẫn NULL → relay khác publish lại → consumer thấy MessageId trùng → dedup bỏ qua. Đây là at-least-once bằng chứng cứ: đếm số lần [[RowsAffected() == 0]] ở consumer.`,
`### Bước 7 — Metric outbox lag
Gauge [[outbox_oldest_unpublished_seconds]] = [[now() − min(created_at) WHERE published_at IS NULL]] (query rẻ nhờ partial index). Alert nếu > 60 s. Khi relay chết, lag tăng tuyến tính — metric này thay cho "không ai biết publisher chết" của sự cố #1.`,
`### Bước 8 — Dọn outbox
Job hằng ngày [[DELETE FROM outbox WHERE published_at < now() − interval '7 days']] theo lô 10k (tránh lock dài), hoặc partition theo tháng và DROP. Đo kích thước bảng và index trước/sau bằng [[pg_total_relation_size]].`
  ],
  accept: [
    'Bước 1 tái hiện được FK violation (hoặc audit mất) khi publish trước commit, có log làm bằng chứng.',
    '10k order qua 2 relay song song: consumer nhận đủ 10k MessageId unique; không order nào thiếu event.',
    'Với CHAOS=1, có ≥ 1 lần relay exit giữa batch nhưng tổng unique vẫn = 10k và consumer ghi nhận ≥ 1 duplicate bị dedup bỏ qua.',
    'Handler createOrder không mở kết nối tới RabbitMQ (kiểm tra bằng cách tắt broker: tạo order vẫn 201, outbox lag tăng).',
    'EXPLAIN cho query relay dùng Index Scan trên outbox_unpublished, không Seq Scan, với bảng ≥ 1M dòng đã publish.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Outbox đổi "2 hệ thống phải cùng thành công" thành "1 transaction + 1 relay có thể retry". Giá: thêm 1 bảng, 1 process, độ trễ publish vài trăm ms, và consumer **bắt buộc** idempotent.
- Thứ tự: relay ORDER BY id trong 1 batch giữ thứ tự, nhưng 2 relay song song thì không. Nếu cần thứ tự theo aggregate, partition relay theo hash(aggregate_id) hoặc chỉ 1 relay (leader) — trade-off throughput.
- Khi broker chết, handler vẫn 201 và outbox phình: đây là tính năng (hấp thụ sự cố) nhưng cần alert lag; tắt broker 10 phút và xem bảng.
- Câu tự vấn: audit log trong hệ thống SBOM hiện publish ở đâu so với commit? Chuyển sang outbox đụng bảng nào, ai là relay (worker hay apiserver), và relay chạy mấy instance?
- CDC (Debezium đọc WAL) là outbox "không cần poll": so sánh độ trễ, độ phức tạp vận hành, và lý do một team nhỏ thường chọn poll.
- Partial index cho relay là ví dụ nhỏ nhưng đúng bản chất của sự cố #16: bảng to, tập quan tâm nhỏ, index toàn bảng vô dụng.`
},
{ id: 'L7', week: 9, title: 'Distributed rate limiter Redis Lua token bucket', time: '3 giờ',
  goal: 'Viết token bucket atomic bằng Lua trên Redis, bọc thành middleware net/http trả 429 + header chuẩn, chạy 2 instance API chung Redis và kiểm chứng bằng hey/k6.',
  stack: 'Go 1.22, Redis 7, go-redis v9, hey hoặc k6',
  steps: [
`### Bước 1 — Vì sao phải Lua
GET rồi SET từ Go là 2 lệnh → 2 instance cùng đọc "còn 1 token" và cùng cho qua. Lua script chạy atomic trong Redis (single thread) nên read-modify-write là một đơn vị. Thiết kế key [[rl:{api_key}]] lưu hash [[tokens]] và [[ts]] (lần nạp cuối, ms).`,
`### Bước 2 — Script token bucket
~~~lua
-- KEYS[1] = bucket key
-- ARGV[1] = capacity, ARGV[2] = refill tokens/giây, ARGV[3] = now ms, ARGV[4] = cost
local cap    = tonumber(ARGV[1])
local rate   = tonumber(ARGV[2])
local now    = tonumber(ARGV[3])
local cost   = tonumber(ARGV[4])
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]); local ts = tonumber(b[2])
if tokens == nil then tokens = cap; ts = now end
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(cap, tokens + elapsed * rate)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) * 2)
local retry = 0
if allowed == 0 then retry = math.ceil((cost - tokens) / rate) end
return {allowed, math.floor(tokens), retry}
~~~
PEXPIRE để key của client không hoạt động tự biến mất (bucket đầy lại = trạng thái mặc định, không cần lưu).`,
`### Bước 3 — Gọi từ Go bằng EVALSHA
~~~go
var tbScript = redis.NewScript(luaSource) // go-redis tự EVALSHA, fallback EVAL khi NOSCRIPT

type Decision struct{ Allowed bool; Remaining int; RetryAfter int }

func (l *Limiter) Allow(ctx context.Context, key string) (Decision, error) {
    now := time.Now().UnixMilli()
    res, err := tbScript.Run(ctx, l.rdb, []string{"rl:" + key}, l.cap, l.rate, now, 1).Int64Slice()
    if err != nil { return Decision{}, err }
    return Decision{Allowed: res[0] == 1, Remaining: int(res[1]), RetryAfter: int(res[2])}, nil
}
~~~
Dùng đồng hồ của app (ARGV now) chứ không phải [[redis.call('TIME')]] để script deterministic với replication; chấp nhận lệch đồng hồ nhỏ giữa instance.`,
`### Bước 4 — Middleware và header
~~~go
func RateLimit(l *Limiter, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            d, err := l.Allow(r.Context(), keyFn(r))
            if err != nil { // Redis lỗi: fail-open có đếm
                rlErrors.Inc()
                next.ServeHTTP(w, r); return
            }
            w.Header().Set("X-RateLimit-Limit", strconv.Itoa(l.cap))
            w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(d.Remaining))
            if !d.Allowed {
                w.Header().Set("Retry-After", strconv.Itoa(d.RetryAfter))
                http.Error(w, "rate limited", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
~~~
keyFn: header [[X-API-Key]] nếu có, ngược lại IP (cẩn thận X-Forwarded-For sau proxy — chỉ tin proxy của mình).`,
`### Bước 5 — Kiểm chứng bằng hey
Cấu hình cap = 100, rate = 50/s. [[hey -n 2000 -c 50 -H "X-API-Key: a" http://localhost:8080/ping]] trong ~4 s: kỳ vọng ~100 (burst) + 50 × 4 s ≈ 300 request 200, còn lại 429. Đếm từ output "Status code distribution". Lệch ±10% là bình thường (hey không chạy đúng 4 s).`,
`### Bước 6 — Hai instance API, một Redis
Chạy API trên :8080 và :8081, bắn hey đồng thời vào cả hai với cùng API key. Tổng số 200 trên cả hai vẫn ≈ 300 — chứng minh limiter là toàn cục. Lặp lại với limiter in-memory (map + mutex) để thấy số 200 tăng gấp đôi.`,
`### Bước 7 — Fail-open hay fail-closed
Tắt Redis giữa lúc chạy hey. Với code bước 4 mọi request đi qua và [[rl_errors_total]] tăng → alert. Thảo luận: cho endpoint login/OTP bạn muốn fail-closed (503) vì chống brute force quan trọng hơn availability. Thêm tham số [[FailClosed bool]] và test cả hai.`,
`### Bước 8 — Latency chi phí limiter
Đo p99 của /ping có và không có middleware: thêm ~1 round trip Redis (0,3–1 ms local). Với 10k RPS, Redis nhận 10k EVALSHA/s — còn xa 100k ops/s nhưng đáng ghi vào capacity plan.`
  ],
  accept: [
    'Với cap 100, rate 50/s, hey 2000 request trong ~4 s cho 270–330 response 200 và phần còn lại 429 có header Retry-After ≥ 1.',
    'Hai instance API chung Redis cho tổng 200 ≈ như 1 instance (lệch < 15%); limiter in-memory cho gấp ~2 lần.',
    'Mọi response (200 lẫn 429) có X-RateLimit-Limit và X-RateLimit-Remaining; Remaining giảm đơn điệu trong burst.',
    'Tắt Redis: chế độ fail-open cho 100% request 200 và counter rl_errors_total tăng; chế độ fail-closed trả 503.',
    'Chi phí middleware đo được: p99 tăng < 2 ms so với không có middleware trên máy local.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Atomicity là lý do dùng Lua; **đồng hồ** là điểm yếu: ARGV now từ nhiều instance lệch 100 ms sẽ cho phép thêm vài token. Chấp nhận được cho rate limit, không chấp nhận được cho inventory.
- Token bucket cho burst = cap: UX tốt hơn sliding window cứng, nhưng "100 request trong 1 ms" vẫn trúng backend. Nếu backend sợ burst, giảm cap hoặc thêm limiter cục bộ per instance.
- Key theo API key vs theo tenant vs theo endpoint: hệ thống SBOM multi-tenant cần ít nhất 2 tầng — per tenant (fairness) và toàn cục cho API ngoài (ClearlyDefined/OSV có quota riêng). Limiter cho **lời gọi đi ra** cũng dùng đúng script này.
- Câu tự vấn: khi bị 429 từ ClearlyDefined, worker của bạn retry sau bao lâu? Có đọc Retry-After không? Hay retry ngay và bị chặn lâu hơn?
- Fail-open làm limiter vô hiệu khi Redis chết — đúng vào lúc hệ thống đang yếu. Đo xem Redis chết bao lâu thì bạn biết (alert nào kêu?).
- Ghi vào ADR: thuật toán, tham số mặc định theo tier, fail-open/closed theo endpoint, header trả về.`
},
{ id: 'L8', week: 10, title: 'Snowflake ID + ULID', time: '2,5 giờ',
  goal: 'Cài Snowflake 64-bit và ULID, xử lý clock đi lùi, benchmark, kiểm tra tính sortable và đo ảnh hưởng lên index B-tree so với UUIDv4.',
  stack: 'Go 1.22, github.com/oklog/ulid/v2, github.com/google/uuid, Postgres 16',
  steps: [
`### Bước 1 — Bit layout Snowflake
63 bit dùng (bit dấu = 0): 41 bit timestamp ms kể từ epoch tùy chọn (~69 năm), 10 bit worker id (1024 worker), 12 bit sequence (4096 id/ms/worker). Viết ra giấy: với epoch 2024-01-01, id sinh hôm nay có timestamp phần nào? Tối đa 4096 × 1000 = 4,1M id/s/worker.`,
`### Bước 2 — Generator
~~~go
const (
    epochMs    = int64(1704067200000) // 2024-01-01T00:00:00Z
    workerBits = 10
    seqBits    = 12
    maxSeq     = int64(1)<<seqBits - 1
)

type Snowflake struct {
    mu     sync.Mutex
    worker int64
    lastMs int64
    seq    int64
}

func (s *Snowflake) Next() (int64, error) {
    s.mu.Lock(); defer s.mu.Unlock()
    now := time.Now().UnixMilli()
    if now < s.lastMs {
        if s.lastMs-now > 5 { return 0, errors.New("clock moved backwards") }
        for now < s.lastMs { time.Sleep(time.Millisecond); now = time.Now().UnixMilli() }
    }
    if now == s.lastMs {
        s.seq = (s.seq + 1) & maxSeq
        if s.seq == 0 { for now <= s.lastMs { now = time.Now().UnixMilli() } }
    } else {
        s.seq = 0
    }
    s.lastMs = now
    return (now-epochMs)<<(workerBits+seqBits) | s.worker<<seqBits | s.seq, nil
}
~~~
Clock lùi ≤ 5 ms: chờ; lớn hơn: trả lỗi để tầng trên quyết định (không bao giờ sinh id trùng).`,
`### Bước 3 — Worker id từ đâu?
Ba cách: biến môi trường (dễ sai khi scale), lấy từ IP cuối (đụng khi nhiều container cùng host), hoặc **lease trong Redis/Postgres**: [[SETNX worker:{n}]] với TTL, gia hạn định kỳ. Cài cách 3 tối giản và test: 3 process khởi động cùng lúc nhận 3 worker id khác nhau.`,
`### Bước 4 — ULID
~~~go
entropy := ulid.Monotonic(rand.Reader, 0)
id := ulid.MustNew(ulid.Timestamp(time.Now()), entropy)
fmt.Println(id.String()) // 26 ký tự Crockford base32, sortable theo thời gian
~~~
ULID = 48 bit ms + 80 bit random; Monotonic đảm bảo trong cùng ms các id tăng dần (chỉ trong 1 process). So sánh với UUIDv7 (cùng ý tưởng, chuẩn RFC 9562, lưu được vào cột uuid của Postgres).`,
`### Bước 5 — Benchmark
[[go test -bench=.]] cho Snowflake.Next, ulid.MustNew (monotonic), uuid.New(). Kỳ vọng: Snowflake vài chục ns (mutex + phép bit), ULID ~100–300 ns (đọc crypto/rand), UUIDv4 ~100–200 ns. Thử Snowflake với 8 goroutine song song: mutex trở thành nút cổ chai? Đo ns/op tăng bao nhiêu.`,
`### Bước 6 — Kiểm tra sortable và duy nhất
Sinh 1M Snowflake từ 4 goroutine (4 worker id khác nhau) → sort theo thời gian sinh, kiểm tra không trùng ([[map[int64]struct{}]]) và id tăng theo thời gian với cùng worker. Với ULID, 1M id từ 1 process monotonic phải tăng nghiêm ngặt về chuỗi.`,
`### Bước 7 — Ảnh hưởng lên B-tree Postgres
Ba bảng [[t_uuid4(id uuid PK)]], [[t_ulid(id uuid PK)]] (ULID chuyển sang 16 byte), [[t_snow(id bigint PK)]]. Insert 1M dòng mỗi bảng theo lô 10k, đo thời gian và [[pg_relation_size]] của index. Kỳ vọng: UUIDv4 index lớn hơn và insert chậm hơn 20–50% vì ghi ngẫu nhiên vào mọi page (page split); ULID/Snowflake ghi vào cuối.`
  ],
  accept: [
    '1M Snowflake id từ 4 worker: không trùng; cùng worker thì tăng nghiêm ngặt.',
    'Mô phỏng clock lùi (set lastMs = now + 3 ms) → Next chờ rồi vẫn trả id tăng; lùi 100 ms → trả lỗi, không trả id.',
    'Benchmark có 3 dòng Snowflake/ULID/UUIDv4 với ns/op và allocs/op; Snowflake < 100 ns/op đơn luồng.',
    '3 process khởi động đồng thời nhận worker id khác nhau qua lease; kill 1 process thì id của nó được cấp lại sau TTL.',
    'Bảng so sánh insert 1M dòng: index UUIDv4 lớn hơn ULID/Snowflake ≥ 15% và insert chậm hơn.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Snowflake đẹp (8 byte, sortable) nhưng kéo theo hai phụ thuộc vận hành: **worker id duy nhất** và **đồng hồ**. ULID/UUIDv7 bỏ cả hai bằng cách trả 8 byte dung lượng. Hệ thống nhỏ, nhiều Lambda/container ngắn hạn → ULID/UUIDv7 thường hợp lý hơn.
- "Sortable" chỉ đúng ở độ phân giải ms và trong 1 nguồn sinh. Hai worker trong cùng ms không có thứ tự — đừng dùng id làm thứ tự nghiệp vụ tuyệt đối.
- Id lộ thông tin: Snowflake lộ thời điểm và worker; ULID lộ thời điểm. Có chấp nhận được cho URL công khai không? (Có thể mã hóa/hash khi hiển thị.)
- Câu tự vấn: khóa chính trong hệ thống SBOM (component, vulnerability link) hiện là gì? Nếu là UUIDv4 và bảng 490k–9,6M dòng, index bloat + random insert đang tốn bao nhiêu? Đo thử bằng [[pgstattuple]].
- Clock lùi xảy ra thật khi NTP chỉnh giờ hoặc VM migrate. Lambda/container mới khởi động có đồng hồ khác nhau vài chục ms là bình thường.
- Nhớ con số: 41 bit ms ≈ 69 năm; 12 bit seq = 4096/ms; UUID 16 byte vs int64 8 byte → index nhỏ hơn một nửa.`
},
{ id: 'L9', week: 11, title: 'Bloom filter + inverted index mini search', time: '3 giờ',
  goal: 'Tự cài bloom filter và đo false positive thực tế so với công thức, rồi xây inverted index cho 10k document với truy vấn AND/OR và đo latency.',
  stack: 'Go 1.22, hash/fnv, testing/benchmark, bộ dữ liệu text bất kỳ (README của Go stdlib hoặc sinh ngẫu nhiên)',
  steps: [
`### Bước 1 — Công thức kích thước bloom filter
Với n phần tử và tỉ lệ false positive mục tiêu p: số bit m = −n·ln(p) / (ln 2)^2, số hash k = (m/n)·ln 2. Tính tay cho n = 100 000, p = 1%: m ≈ 958 506 bit ≈ 117 KB, k ≈ 7. So sánh: lưu 100k chuỗi 20 byte trong map tốn ≥ 2 MB → bloom nhỏ hơn ~20 lần.`,
`### Bước 2 — Cài bloom với double hashing
~~~go
type Bloom struct {
    bits []uint64
    m    uint64
    k    uint64
}

func NewBloom(n int, p float64) *Bloom {
    m := uint64(math.Ceil(-float64(n) * math.Log(p) / (math.Ln2 * math.Ln2)))
    k := uint64(math.Round(float64(m) / float64(n) * math.Ln2))
    return &Bloom{bits: make([]uint64, (m+63)/64), m: m, k: k}
}

func (b *Bloom) idx(data []byte) (uint64, uint64) {
    h := fnv.New64a(); h.Write(data); s := h.Sum64()
    return s & 0xffffffff, s >> 32 // h1, h2 (Kirsch–Mitzenmacher)
}

func (b *Bloom) Add(data []byte) {
    h1, h2 := b.idx(data)
    for i := uint64(0); i < b.k; i++ {
        pos := (h1 + i*h2) % b.m
        b.bits[pos/64] |= 1 << (pos % 64)
    }
}

func (b *Bloom) MayContain(data []byte) bool {
    h1, h2 := b.idx(data)
    for i := uint64(0); i < b.k; i++ {
        pos := (h1 + i*h2) % b.m
        if b.bits[pos/64]&(1<<(pos%64)) == 0 { return false }
    }
    return true
}
~~~
Chỉ cần 1 lần hash 64 bit, tách thành 2 nửa rồi tổ hợp tuyến tính — rẻ hơn k lần hash thật mà chất lượng gần tương đương.`,
`### Bước 3 — Đo false positive thực tế
Thêm 100k key "in-%d", kiểm tra 100k key "out-%d" chưa từng thêm; FP = số MayContain true / 100k. Lặp với p mục tiêu 10%, 1%, 0,1% và lập bảng p lý thuyết | p đo | m (KB) | k. Kỳ vọng sai lệch < 20% tương đối. Kiểm tra không có false negative: mọi key "in" phải true.`,
`### Bước 4 — Tokenizer và inverted index
~~~go
type Index struct {
    postings map[string][]int // term → doc id tăng dần
    docs     []string
}

func tokenize(s string) []string {
    f := func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }
    out := strings.FieldsFunc(strings.ToLower(s), f)
    return out
}

func (ix *Index) Add(doc string) int {
    id := len(ix.docs); ix.docs = append(ix.docs, doc)
    seen := map[string]bool{}
    for _, t := range tokenize(doc) {
        if seen[t] { continue }
        seen[t] = true
        ix.postings[t] = append(ix.postings[t], id) // id luôn tăng → list đã sắp xếp
    }
    return id
}
~~~
Nạp 10k document (mỗi doc 50–200 từ). In số term, kích thước trung bình posting list, 10 term phổ biến nhất (stop word).`,
`### Bước 5 — AND bằng giao 2 list đã sắp xếp
~~~go
func intersect(a, b []int) []int {
    out := make([]int, 0, min(len(a), len(b)))
    i, j := 0, 0
    for i < len(a) && j < len(b) {
        switch {
        case a[i] == b[j]: out = append(out, a[i]); i++; j++
        case a[i] < b[j]: i++
        default: j++
        }
    }
    return out
}
~~~
Với n term, giao từ list **ngắn nhất** trước (sort theo len) để sớm thu hẹp. OR = merge union. Viết [[Query(expr string)]] hỗ trợ "a AND b", "a OR b", và phủ định NOT đơn giản.`,
`### Bước 6 — Đo latency truy vấn
Benchmark 3 kiểu: term hiếm AND term hiếm (vài µs), term phổ biến AND term phổ biến (posting list dài nghìn phần tử → vài chục µs), OR 5 term. So với brute-force [[strings.Contains]] trên 10k doc (ms). Ghi tỉ lệ tăng tốc.`,
`### Bước 7 — Bloom làm "có nên tìm trong segment này không?"
Chia index thành 10 segment (1k doc mỗi cái) như Lucene/SSTable; mỗi segment có bloom filter các term. Truy vấn term hiếm: kiểm tra bloom trước, chỉ mở segment có thể chứa. Đếm số segment phải mở với và không có bloom. Đây đúng là vai trò bloom trong LSM: bỏ qua SSTable không có key.`,
`### Bước 8 — Nâng cao (tùy chọn): ranking
Lưu term frequency trong posting (doc id, tf) và tính TF-IDF đơn giản để sắp xếp kết quả OR. Thấy ngay vì sao Elasticsearch cần nhiều RAM: posting + tf + norm cho hàng tỉ term.`
  ],
  accept: [
    'Bảng FP cho p = 10%, 1%, 0,1%: FP đo được lệch < 20% tương đối so với lý thuyết; false negative = 0 trên 100k key.',
    'Bloom cho n = 100k, p = 1% chiếm ≤ 130 KB bộ nhớ (kiểm bằng len(bits) × 8).',
    'Index 10k document; truy vấn AND 2 term phổ biến < 100 µs, nhanh hơn brute-force Contains ≥ 50 lần.',
    'Test đơn vị: intersect/union đúng trên các trường hợp rỗng, trùng, không giao nhau; kết quả AND là tập con của mỗi posting list.',
    'Với 10 segment và term hiếm, bloom giúp mở ≤ 2 segment thay vì 10 (có đếm).'
  ],
  observe: `### Cần quan sát và tự hỏi
- Bloom filter là ví dụ gọn nhất của **trade-off bộ nhớ ↔ độ chính xác**: thêm 1 bit/phần tử giảm FP ~2 lần cho đến điểm bão hòa. Khi phỏng vấn, nói được "10 bit/phần tử ≈ 1%, k ≈ 7" là đủ.
- Không xóa được: nếu dữ liệu đổi thường xuyên phải rebuild theo chu kỳ hoặc dùng counting bloom (×4 bộ nhớ). Đây là lý do bloom hợp với dữ liệu bất biến (SSTable, segment).
- Inverted index nhanh vì công việc nặng dồn vào lúc **ghi** (tokenize, sắp xếp). Elasticsearch index rate vài nghìn doc/s/node là vì thế; "search as you type" trên Postgres LIKE %x% không có đường tắt.
- Câu tự vấn: tìm component theo tên/purl trong hệ thống SBOM đi qua Postgres hay Elasticsearch? Nếu Postgres: có GIN trigram chưa, và bảng nào đang Seq Scan?
- Posting list của stop word ("the", "lib") dài bằng cả tập doc → term phổ biến làm AND chậm; thực tế bỏ stop word hoặc dùng skip list.
- Cardinality lại xuất hiện: số term duy nhất quyết định RAM; purl với version là term gần như duy nhất mỗi dòng — nghĩ về việc tách name và version khi index.`
},
{ id: 'L10', week: 12, title: 'Distributed cron không lỡ tick', time: '3,5 giờ',
  goal: 'Xây scheduler chạy trên 2 instance với lease trong Postgres: đúng 1 instance chạy mỗi tick, kill 1 instance giữa chừng vẫn không double-run và không miss, có catch-up sau downtime.',
  stack: 'Go 1.22, Postgres 16, pgx v5, docker compose (2 replica)',
  steps: [
`### Bước 1 — Tái hiện vấn đề gocron in-memory (sự cố #9)
Viết scheduler đơn giản bằng [[time.Ticker]] 10 s in "tick" + ghi bảng [[runs(job, run_at, instance)]]. Chạy 2 instance → mỗi tick ghi 2 dòng (double-run). Rồi mô phỏng Watchtower: [[docker compose restart]] mỗi 30 s trong 5 phút → đếm tick thiếu (khoảng cách giữa 2 run_at liên tiếp > 15 s). Ghi 2 con số: số double-run, số tick lỡ.`,
`### Bước 2 — Bảng lịch bền
~~~sql
CREATE TABLE scheduled_jobs (
  name         text PRIMARY KEY,
  interval_sec int  NOT NULL,
  next_run_at  timestamptz NOT NULL,
  lease_until  timestamptz,
  lease_owner  text,
  last_success timestamptz
);
INSERT INTO scheduled_jobs VALUES ('scan', 10, now(), NULL, NULL, NULL);
~~~
Lịch sống trong DB, không trong RAM process: restart không mất "tick kế tiếp là lúc nào".`,
`### Bước 3 — Claim job bằng một câu UPDATE atomic
~~~go
const claimSQL = "UPDATE scheduled_jobs SET lease_until = now() + ($2 || ' seconds')::interval, lease_owner = $1 " +
    "WHERE name = (SELECT name FROM scheduled_jobs WHERE next_run_at <= now() " +
    "  AND (lease_until IS NULL OR lease_until < now()) ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED) " +
    "RETURNING name, next_run_at, interval_sec"

func claim(ctx context.Context, instance string, leaseSec int) (*Job, error) {
    var j Job
    err := pool.QueryRow(ctx, claimSQL, instance, leaseSec).Scan(&j.Name, &j.NextRunAt, &j.IntervalSec)
    if errors.Is(err, pgx.ErrNoRows) { return nil, nil }
    return &j, err
}
~~~
Một câu lệnh vừa chọn vừa khóa vừa gán lease: hai instance không thể cùng claim một job. Lease (ví dụ 60 s) phải dài hơn thời gian chạy job dự kiến.`,
`### Bước 4 — Chạy job, gia hạn lease, hoàn tất
~~~go
func runLoop(ctx context.Context, instance string) {
    t := time.NewTicker(time.Second); defer t.Stop()
    for range t.C {
        j, err := claim(ctx, instance, 60)
        if err != nil || j == nil { continue }
        hb := heartbeat(ctx, j.Name, instance, 20*time.Second) // gia hạn lease mỗi 20 s
        err = doWork(ctx, j)
        hb.Stop()
        next := j.NextRunAt.Add(time.Duration(j.IntervalSec) * time.Second)
        if next.Before(time.Now()) { next = time.Now() } // catch-up: tick quá cũ → chạy ngay lần nữa, không chạy bù N lần
        pool.Exec(ctx, "UPDATE scheduled_jobs SET lease_until = NULL, lease_owner = NULL, "+
            "next_run_at = $2, last_success = CASE WHEN $3 THEN now() ELSE last_success END WHERE name = $1",
            j.Name, next, err == nil)
    }
}
~~~
Quyết định catch-up: lỡ 5 tick trong lúc down → chạy 1 lần ngay rồi về lịch bình thường (đủ cho "scheduled scan"); job dạng billing theo kỳ thì phải chạy bù từng kỳ — ghi rõ lựa chọn.`,
`### Bước 5 — Phương án B: advisory lock
So sánh với [[SELECT pg_try_advisory_xact_lock(hashtext('scan'))]] trong tx: đơn giản, không cần cột lease, nhưng lock gắn với **kết nối**: kết nối rớt là lock mất ngay (tốt), còn tx dài giữ kết nối pool suốt job (xấu). Cài bản này 20 dòng và ghi 3 khác biệt.`,
`### Bước 6 — Chaos với 2 instance
Chạy 2 replica. [[doWork]] sleep 15 s và ghi [[runs]]. Trong lúc instance A đang chạy: [[docker kill A]]. Kỳ vọng: B không chạy trùng ngay (lease còn), sau khi lease hết (≤ 60 s) B claim và chạy; bảng runs không có 2 dòng cùng next_run_at. Restart A → A quay lại tranh claim bình thường.`,
`### Bước 7 — Mô phỏng Watchtower 30 s
Restart xen kẽ 2 instance mỗi 30 s trong 10 phút. Đếm: số tick có đúng 1 run, số tick 0 run, số tick ≥ 2 run. Mục tiêu: 0 double, 0 miss (trừ trễ ≤ lease).`,
`### Bước 8 — Metric và alert
Gauge [[job_last_success_age_seconds{job}]] = now − last_success. Alert khi > 3 × interval. Thêm gauge [[job_lease_held{job}]] để thấy ai đang giữ. Đây là cặp metric phải có cho mọi scheduled scan trong hệ thống SBOM.`
  ],
  accept: [
    'Bước 1 ghi lại được ≥ 1 double-run và ≥ 1 tick lỡ với scheduler in-memory 2 instance + restart 30 s.',
    'Với lease trong Postgres, 10 phút chạy 2 instance + restart xen kẽ: 0 tick có ≥ 2 run; mọi khoảng cách run_at liên tiếp ≤ interval + lease (70 s).',
    'docker kill instance đang chạy job → instance còn lại tiếp quản trong ≤ 60 s, không có run trùng.',
    'Dừng cả 2 instance 5 phút rồi bật lại → job chạy đúng 1 lần ngay (catch-up), rồi về đúng chu kỳ 10 s.',
    'Metric job_last_success_age_seconds expose được và vượt ngưỡng khi job bị dừng.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Hai bệnh của cron in-memory là **double-run** (nhiều instance) và **miss** (restart) — chữa bằng một nguyên tắc: lịch và quyền chạy sống ở store chung, không ở process.
- Lease dài → failover chậm; lease ngắn → cần heartbeat và job dài rủi ro mất lease giữa chừng. Nếu mất lease, job vẫn đang chạy ở A trong khi B bắt đầu — đây là lúc cần fencing token hoặc idempotent job.
- Catch-up là quyết định nghiệp vụ, không phải kỹ thuật: scan bù 1 lần hay bù N lần? Thông báo lỡ có gửi lại không? Viết thành 3 dòng trong ADR.
- Câu tự vấn: scheduled scan + sync feed (OSV/NVD) trong hệ thống SBOM hiện có bao nhiêu job, mỗi job có last_success không? Nếu Watchtower redeploy lúc 02:00 đúng giờ cron thì sao?
- Advisory lock gắn với connection là con dao hai lưỡi: pool reuse kết nối khiến lock "rò" sang request khác nếu dùng session-level mà quên unlock → luôn dùng xact-level.
- Số liệu cần nhớ: Watchtower poll 30 s; lease 60 s; alert 3 × interval. Mọi con số này phải nằm trong config, không hard-code.`
},
{ id: 'L11', week: 14, title: 'Load test + pprof tìm bottleneck', time: '4 giờ',
  goal: 'Dùng k6 và pprof tìm ra endpoint Preload toàn bộ dữ liệu (sự cố #3), sửa thành stream/paginate có giới hạn concurrency, so sánh RSS và p99 trước/sau, đặt memory limit + GOMEMLIMIT.',
  stack: 'Go 1.22, Postgres 16, pgx v5, k6, net/http/pprof, docker stats',
  steps: [
`### Bước 1 — API mẫu có bug cố ý
Bảng [[vulnerabilities(id, project_id, cve, severity, description text)]] với 1 project lớn 500k dòng (description ~500 byte) và 50 project nhỏ 1k dòng. Endpoint [[GET /projects/{id}/vulns/summary]] đếm theo severity nhưng cài kiểu "Preload hết rồi đếm trong Go":
~~~go
func summaryBad(ctx context.Context, projectID int) (map[string]int, error) {
    rows, err := pool.Query(ctx, "SELECT severity, description FROM vulnerabilities WHERE project_id = $1", projectID)
    if err != nil { return nil, err }
    defer rows.Close()
    var all []Vuln // 500k struct × ~600 B ≈ 300 MB cho 1 request
    for rows.Next() {
        var v Vuln; rows.Scan(&v.Severity, &v.Description); all = append(all, v)
    }
    out := map[string]int{}
    for _, v := range all { out[v.Severity]++ }
    return out, nil
}
~~~
Bật pprof: [[import _ "net/http/pprof"]] và serve trên :6060.`,
`### Bước 2 — Chạy trong container có đo RSS
Build image, chạy với [[--memory=1g]] để thấy OOM thật. Mở terminal [[docker stats]] để nhìn MEM USAGE theo thời gian thực. Ghi RSS lúc idle (~20 MB).`,
`### Bước 3 — k6 script
~~~js
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { vus: 10, duration: '60s' };
export default function () {
  const id = Math.random() < 0.2 ? 1 : 2 + Math.floor(Math.random() * 50); // 20% trúng project lớn
  const res = http.get('http://host.docker.internal:8080/projects/' + id + '/vulns/summary');
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(0.1);
}
~~~
Chạy [[k6 run script.js]]. Kỳ vọng: RSS vọt lên hàng trăm MB rồi container bị kill (OOMKilled) hoặc p99 vài giây vì GC. Ghi p95/p99 và số request fail.`,
`### Bước 4 — pprof heap trong lúc tải
Trong lúc k6 chạy (giảm vus = 2 để container sống): [[go tool pprof -http=:8081 http://localhost:6060/debug/pprof/heap]]. Xem [[inuse_space]] theo top và flame graph: hàm summaryBad và [[append]] chiếm phần lớn. Chụp lại. Thử thêm [[?debug=1]] vào /debug/pprof/goroutine để đếm goroutine đang chờ DB.`,
`### Bước 5 — pprof CPU
[[curl -o cpu.pprof http://localhost:6060/debug/pprof/profile?seconds=30]] trong lúc tải. Top thường là runtime.mallocgc + GC (scanobject) chứ không phải logic nghiệp vụ → dấu hiệu "alloc quá nhiều", không phải "tính toán nhiều".`,
`### Bước 6 — Sửa: đẩy việc xuống DB, stream khi cần dòng
~~~go
func summaryGood(ctx context.Context, projectID int) (map[string]int, error) {
    rows, err := pool.Query(ctx,
        "SELECT severity, count(*) FROM vulnerabilities WHERE project_id = $1 GROUP BY severity", projectID)
    if err != nil { return nil, err }
    defer rows.Close()
    out := map[string]int{}
    for rows.Next() { var s string; var c int; rows.Scan(&s, &c); out[s] = c }
    return out, nil
}
~~~
Cho endpoint cần trả dòng ([[/vulns]] đầy đủ): keyset pagination [[WHERE project_id = $1 AND id > $2 ORDER BY id LIMIT 1000]] hoặc stream NDJSON ghi từng dòng ra [[http.Flusher]] — RAM O(1 dòng) thay vì O(N). Thêm index [[(project_id, id)]] và [[(project_id, severity)]].`,
`### Bước 7 — Giới hạn concurrency cho việc nặng
Dù đã stream, 10 request đồng thời × 1000 dòng buffer vẫn cộng dồn. Thêm semaphore [[make(chan struct{}, 4)]] quanh endpoint nặng; vượt quá → 503 + Retry-After (load shedding). Sự cố #3 là 10 goroutine × Preload — concurrency không giới hạn nhân RAM lên 10 lần.`,
`### Bước 8 — Memory limit + GOMEMLIMIT và so sánh
Chạy lại với [[--memory=512m]] và env [[GOMEMLIMIT=400MiB]]. Lặp k6 vus = 10: RSS phải ổn định < 300 MB, p99 < 200 ms, 0 fail. Lập bảng trước/sau: RSS peak | p50 | p99 | fail | OOMKilled. Kiểm tra [[docker inspect --format '{{.State.OOMKilled}}']] và lưu ý: cgroup OOM toàn host có thể kill mà cờ này vẫn false — hãy nhìn [[dmesg]] khi nghi ngờ.`
  ],
  accept: [
    'Phiên bản bug với --memory=1g và k6 vus=10: container OOMKilled hoặc p99 > 2 s, có chụp docker stats cho thấy RSS > 500 MB.',
    'pprof heap chỉ đích danh summaryBad/append chiếm ≥ 50% inuse_space (có ảnh hoặc text top).',
    'Phiên bản sửa: RSS peak < 300 MB với --memory=512m, p99 < 200 ms, 0 request fail trong 60 s vus=10.',
    'EXPLAIN ANALYZE cho GROUP BY dùng index (project_id, severity) hoặc Index Only Scan; thời gian < 100 ms với project 500k dòng.',
    'Semaphore 4 hoạt động: với vus=20 trên endpoint nặng, một phần request nhận 503 nhanh (< 50 ms) thay vì mọi request đều chậm.'
  ],
  observe: `### Cần quan sát và tự hỏi
- Bottleneck ở đây không phải CPU hay DB mà là **alloc**: GC chạy liên tục để dọn 300 MB mỗi request. pprof CPU hiển thị mallocgc/scanobject là dấu hiệu nhận biết.
- "Preload" của ORM là cú pháp dễ chịu cho lỗi O(N) RAM. Mỗi khi thấy Preload/Find không LIMIT trên bảng có thể lớn, hỏi: N tối đa là bao nhiêu và nhân với bao nhiêu goroutine?
- Memory limit container không có là lý do sự cố #3 kéo cả host; GOMEMLIMIT làm GC tích cực hơn khi gần trần (đổi CPU lấy RAM) nhưng không cứu được live heap thật sự lớn — phải sửa thuật toán.
- OOMKilled=false không có nghĩa không OOM: kernel global OOM killer, hoặc process bị kill từ cgroup cha. Ghi vào runbook: xem dmesg và docker events.
- Câu tự vấn: worker SBOM hiện có endpoint pprof không? Nếu không, bước đầu tuần là bật nó sau cổng nội bộ — không có pprof thì sự cố RAM chỉ đoán.
- Load test phải có **mix** thực tế (20% project lớn): chỉ test project nhỏ sẽ không thấy gì. Tenant 200k component là profile tải cần có trong k6 của bạn.`
},
{ id: 'L12', week: 18, title: 'Capstone: mini SBOM pipeline', time: '4 giờ (có thể chia 2 buổi)',
  goal: 'Ghép mọi pattern đã học thành pipeline upload → queue → enrich gọi API giả có lỗi/rate limit → isolate per item, retry/backoff, DLQ, status machine, sweeper fair theo tenant, metric Prometheus + alert "no success 5 phút".',
  stack: 'Go 1.22, Postgres 16, RabbitMQ 3.13, Redis 7, Prometheus + Alertmanager (docker compose), k6/hey',
  steps: [
`### Bước 1 — Sơ đồ và status machine
:::diagram
Client[Upload SBOM] -> API[apiserver]
API -> DB[Postgres]
API -> OB[outbox relay] : cùng tx
OB -> MQ[RabbitMQ enrich.batch]
MQ -> EN[enricher worker]
EN -> EXT[Fake license API] : batch 50
EN -> DB : update status
SW[Sweeper fair theo tenant] -> DB
SW -> MQ : re-publish pending
EN -> DLQ[enrich.dlq] : lỗi vĩnh viễn
PM[Prometheus] -> EN : scrape /metrics
:::
Trạng thái mỗi component: [[pending → processing → done | failed_transient (retry_at, attempts) | failed_permanent | no_locator]]. Vẽ bảng chuyển trạng thái: từ | sự kiện | đến. Không có trạng thái nào là "kẹt vĩnh viễn mà vẫn tên pending".`,
`### Bước 2 — Upload và parse
[[POST /tenants/{t}/sboms]] nhận JSON tối giản [[{components:[{name, version, purl}]}]]. Trong 1 tx: insert sbom, insert components (status pending; purl rỗng → no_locator ngay, bài học sự cố #16), insert outbox event [[enrich.requested{sbom_id}]]. Relay từ L6 publish sang [[enrich.batch]]. Sinh dữ liệu: 3 tenant nhỏ (1k component) + 1 tenant lớn (100k, trong đó 30% không purl).`,
`### Bước 3 — Fake license API có lỗi
~~~go
func fakeLicense(w http.ResponseWriter, r *http.Request) {
    var req struct{ Coordinates []string }
    json.NewDecoder(r.Body).Decode(&req)
    if rand.Float64() < 0.05 { http.Error(w, "boom", 500); return }          // lỗi tạm cả batch
    if !limiter.Allow() { w.Header().Set("Retry-After", "2"); http.Error(w, "slow down", 429); return }
    out := map[string]any{}
    for _, c := range req.Coordinates {
        switch {
        case strings.Contains(c, "~") || strings.Contains(c, ">="): // version-range: lỗi vĩnh viễn per item
            out[c] = map[string]any{"error": "unsupported version range"}
        case rand.Float64() < 0.02:
            out[c] = map[string]any{"error": "temporarily unavailable"}
        default:
            out[c] = map[string]any{"license": "MIT"}
        }
    }
    json.NewEncoder(w).Encode(out)
}
~~~
Mô phỏng đúng sự cố #7: trong một batch có item hỏng vĩnh viễn lẫn item lỗi tạm, và đôi khi cả batch 500/429.`,
`### Bước 4 — Enricher: isolate per item, phân loại lỗi
~~~go
func processBatch(ctx context.Context, items []Component) {
    resp, err := callLicense(ctx, coords(items))
    if err != nil { // 500/429/timeout: cả batch là transient
        for _, it := range items { markTransient(ctx, it, err) }
        if ra := retryAfter(err); ra > 0 { time.Sleep(ra) }
        return
    }
    for _, it := range items {
        r, ok := resp[it.Purl]
        switch {
        case !ok || r.Err == "temporarily unavailable":
            markTransient(ctx, it, errors.New(r.Err))
        case r.Err != "":
            markPermanent(ctx, it, r.Err) // không bao giờ retry; publish sang DLQ để xem lại
        default:
            markDone(ctx, it, r.License)
        }
    }
}
~~~
[[markTransient]]: attempts++, [[retry_at = now + min(5 phút, 2^attempts giây) + jitter]]; attempts > 8 → failed_permanent. Không nuốt lỗi: mọi nhánh đều ghi lý do vào cột [[last_error]].`,
`### Bước 5 — Sweeper fair theo tenant
~~~sql
CREATE INDEX comp_due ON components (tenant_id, retry_at)
  WHERE status IN ('pending', 'failed_transient');
~~~
~~~go
func sweepOnce(ctx context.Context, budget time.Duration) {
    deadline := time.Now().Add(budget)
    tenants := listTenantsWithDue(ctx) // SELECT DISTINCT tenant_id ... (dùng partial index)
    for _, t := range tenants {
        if time.Now().After(deadline) { sweepBudgetExhausted.Inc(); return }
        ids := claimDue(ctx, t, 200) // UPDATE ... WHERE id IN (SELECT ... LIMIT 200 FOR UPDATE SKIP LOCKED) RETURNING id
        publishBatches(ctx, ids, 50)
        sweptTotal.WithLabelValues(t).Add(float64(len(ids)))
    }
}
~~~
Round-robin 200 dòng/tenant/vòng thay vì "100 dòng cũ nhất toàn hệ thống" (sự cố #8): tenant lớn không chặn tenant nhỏ, dòng lỗi có retry_at tương lai không chiếm chỗ. Đo thời gian query claim: phải ms nhờ partial index.`,
`### Bước 6 — Metric Prometheus
Counter [[enrich_items_total{tenant,result}]], Gauge [[enrich_pending{tenant}]] (query định kỳ 30 s), Gauge [[enrich_last_success_timestamp]], Histogram [[external_api_duration_seconds{code}]], Counter [[sweep_budget_exhausted_total]]. Expose [[/metrics]]; Prometheus scrape 15 s. Nguyên tắc cardinality: label tenant OK (hữu hạn), **không** label component_id/purl.`,
`### Bước 7 — Alert "no success 5 phút" và "pending không giảm"
~~~yaml
groups:
- name: enrich
  rules:
  - alert: EnrichNoSuccess
    expr: (time() - enrich_last_success_timestamp) > 300 and sum(enrich_pending) > 0
    for: 1m
  - alert: EnrichPendingStuck
    expr: sum(enrich_pending) > 1000 and deriv(sum(enrich_pending)[15m:]) >= 0
    for: 15m
  - alert: DLQNotEmpty
    expr: rabbitmq_queue_messages{queue="enrich.dlq"} > 0
~~~
Alert đầu bắt sự cố #1/#2 (im lặng); alert thứ hai bắt sự cố #8 (sweep xử lý 0 dòng); alert thứ ba bắt lỗi vĩnh viễn cần người xem.`,
`### Bước 8 — Chaos drill
1) [[docker restart rabbitmq]] trong lúc enrich: publisher reconnect (L4), outbox lag tăng rồi về 0. 2) Xóa env [[REDIS_HOST]] của enricher và restart: process phải **exit ngay** với lỗi config, không fallback localhost (sự cố #2). 3) Tắt fake API 6 phút: EnrichNoSuccess phải fire trong Alertmanager, pending không mất, bật API lại thì tự trả nợ. 4) Bơm tenant lớn 100k: tenant nhỏ vẫn done trong < 2 phút.`,
`### Bước 9 — Báo cáo capstone
Viết 1 trang: sơ đồ, status machine, bảng metric/alert, kết quả 4 chaos drill (số liệu), 3 điều bạn sẽ đem áp dụng vào hệ thống SBOM thật tuần tới (ví dụ: partial index cho pending, alert last_success, fail-fast config). Đây là câu chuyện phỏng vấn "tell me about a system you designed" của bạn.`
  ],
  accept: [
    'Sau khi upload 4 tenant (3 × 1k + 1 × 100k với 30% không purl): 0 component ở trạng thái pending quá 10 phút; component không purl ở no_locator ngay lúc upload.',
    'Với fake API lỗi 5% batch + 2% item tạm thời + version-range vĩnh viễn: item version-range → failed_permanent và có trong DLQ; item lỗi tạm → done sau retry; không có batch nào bị đánh fail toàn bộ vì 1 item.',
    'Tenant nhỏ hoàn tất enrich trong < 2 phút dù tenant lớn 100k đang chạy (sweeper fair); query claim của sweeper < 50 ms (EXPLAIN dùng partial index).',
    'Tắt fake API 6 phút → alert EnrichNoSuccess ở trạng thái firing; bật lại → pending về 0 không cần can thiệp tay.',
    'Xóa REDIS_HOST → enricher exit code ≠ 0 trong < 2 s với thông báo config rõ ràng; docker restart rabbitmq → không mất event (đếm done = tổng component có purl).'
  ],
  observe: `### Cần quan sát và tự hỏi
- Pipeline này gói 6 sự cố thật (#1, #2, #7, #8, #12, #16) vào một hệ thống nhỏ. Mỗi guard bạn thêm (fail-fast config, isolate per item, partial index, fairness, outbox, last_success alert) tương ứng với vài ngày debug ngoài đời.
- Status machine rõ ràng là thứ biến "pending kẹt hàng giờ" thành câu hỏi trả lời được trong 1 query: bao nhiêu dòng ở trạng thái nào, lý do gì, retry lúc nào.
- Phân loại lỗi vĩnh viễn vs tạm thời là quyết định quan trọng nhất của enricher; sai một chiều thì hoặc retry mãi (zombie) hoặc bỏ cuộc quá sớm. Hãy đếm theo [[last_error]] để điều chỉnh.
- Fairness theo tenant có giá: tenant lớn chậm hơn so với FIFO thuần. Hỏi PO: SLA enrich cho tenant 100k component là bao lâu? Không có con số đó thì không thể nói sweeper "đủ nhanh".
- Alert dựa trên **kết quả** (last_success, pending không giảm) thay vì lỗi: hệ thống im lặng vẫn bị bắt. Kiểm tra lại: hệ thống SBOM thật hiện có alert nào thuộc loại này?
- Metric cardinality: label tenant với 1 000 tenant × 5 result = 5 000 series — ổn; thêm label sbom_id là bùng nổ. Lý do bạn thấy Prometheus/ES OOM ở nhiều nơi.
- Câu tự vấn cuối: nếu Lambda thay enricher container (như prod thật), bước nào trong pipeline đổi? (connection pool, env, timeout 15 phút, Redis L1 cache, publish RabbitMQ từ Lambda) — viết 5 dòng.`
}
];
