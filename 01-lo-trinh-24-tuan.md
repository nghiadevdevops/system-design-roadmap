# Lộ trình System Design 24 tuần

Bản in của lộ trình trong app `index.html` (mở app để học, làm quiz, mock, test). Mỗi tuần 8–12 giờ.

## Nguyên tắc
1. **Nền trước, bài mẫu sau.** 5 tuần đầu không học thuộc lời giải nào. Bài mẫu chỉ có giá trị khi bạn tự giải được 60% rồi mới so.
2. **Mọi khái niệm phải đi kèm một con số và một trade-off.** Không nói "dùng cache cho nhanh"; nói "cache-aside, TTL 5 phút, hit rate kỳ vọng 90%, chấp nhận dữ liệu cũ tối đa 5 phút".
3. **Mock lạnh trước, đọc case sau.** Thứ Hai làm đề 45 phút không gợi ý, thứ Ba mới đọc lời giải và ghi 3 khác biệt. Đọc trước rồi làm là tự lừa mình.
4. **Nói to.** Phỏng vấn chấm cách bạn dẫn dắt, không chấm sơ đồ đẹp. Ghi âm 10 phút tóm tắt thiết kế mỗi tuần, nghe lại.
5. **Áp dụng vào công việc trong tuần.** Mỗi bài có mục "Áp dụng vào hệ thống SBOM của bạn". Thứ Sáu chọn một việc: đo một metric, thêm một timeout, viết một ADR. Ghi vào Sổ tay thiết kế.
6. **Ôn ngắt quãng.** Flashcard 10–15 phút mỗi ngày (Leitner 5 hộp). Số liệu không ôn sau 7 ngày coi như chưa học.
7. **Sổ tay là tài sản.** Mọi quyết định, sự cố, bài học ghi vào Sổ tay theo mẫu. Đây chính là kho câu chuyện STAR cho vòng behavioral và là design doc nháp cho công việc.

## Tổng quan
| Giai đoạn | Tuần | Mục tiêu | Đầu ra đo được | Giờ/tuần |
|---|---|---|---|---|
| 1. Nền tảng | 1–5 | Số liệu, ước lượng, mạng, OS, DB, API, cache, queue, độ tin cậy, mở rộng | KT1 ≥ 21/30; 4 lab xong; thẻ D1–D2 ≥ 80% ở hộp ≥ 3 | 8–10 |
| 2. Khối xây dựng | 6–13 | 20 building block: replication, sharding, consistency, consensus, giao dịch phân tán, broker, rate limit, ID, search, storage, data, observability, security, microservices, resilience, deploy, multi-tenant, realtime | KT2 ≥ 22/30; 4 mock lạnh trung bình ≥ 8/15; 6 lab | 9–11 |
| 3. Bài toán kinh điển | 14–20 | 19 case study (gồm bài SBOM của chính bạn); mỗi tuần 1 mock lạnh + đọc 3 case + làm lại | KT3 ≥ 24/30; mock trung bình ≥ 10/15; M1 làm lại hơn baseline ≥ 4 điểm | 9–11 |
| 4. Phỏng vấn & thực chiến | 21–24 | Go, concurrency, SQL, LLD, networking, OS, cloud, testing, behavioral, postmortem, design doc; 6 đề lạ | KT4 ≥ 26/30; đề lạ trung bình ≥ 11/15; 6 câu chuyện STAR viết xong | 10–12 |

**Tuần 1 bắt buộc có baseline:** làm KT0 (30 phút) và mock M1 (URL shortener) **lạnh, không mở gợi ý**, lưu kết quả. Tuần 14 làm lại M1 để thấy khoảng cách. Người đã có kinh nghiệm: KT0 ≥ 22/30 thì có thể lướt Giai đoạn 1 trong 2 tuần (đọc "Cốt lõi" + làm quiz, bỏ qua bài nào quiz ≥ 7/8), nhưng vẫn làm đủ lab L2–L4.

**Điều kiện chuyển giai đoạn** ghi ở cột "Đầu ra đo được". Không đạt thì kéo dài 1–2 tuần, không bỏ bài. Mọi thứ trong app chạy offline, tiến độ lưu trong trình duyệt; xuất JSON ở trang Cài đặt mỗi tuần.

## Giai đoạn 1 · Nền tảng (tuần 1–5)

**Lịch trong tuần (áp dụng cho mọi tuần của giai đoạn):**

- Thứ 2: Bài học 1 của tuần: đọc "Cốt lõi" 60 phút, làm quiz, ghi 3 ý vào Sổ tay; Flashcard 10 phút (bộ D1–D2 trước)
- Thứ 3: Hỏi nhanh (Oral) 5 câu, nói to, bấm giờ 2 phút/câu; Flashcard 15 phút; Quiz bài 1 dưới 7/8 thì đọc lại phần sai và làm lại
- Thứ 4: Bài học 2 của tuần + quiz; Flashcard 10 phút
- Thứ 5: Lab tuần này (2–3 giờ, có thể chia 2 buổi); tick từng bước trong trang Lab
- Thứ 6: Oral 5 câu; Áp dụng: chọn 1 việc trong mục "Áp dụng vào hệ thống SBOM" làm tại công ty (đo một con số, thêm một timeout, viết một ADR) → ghi Sổ tay
- Thứ 7: Drill trộn 20 câu (trang Drill); Flashcard: ôn hết thẻ đến hạn; Máy tính ước lượng: tự nghĩ 1 hệ thống và tính QPS/dung lượng trong 10 phút
- Chủ nhật: nghỉ

### Tuần 1
*Tư duy thiết kế, số liệu phải thuộc, ước lượng. Baseline: KT0 + mock M1 lạnh (không gợi ý).*

- **F1** Tư duy system design: yêu cầu, trade-off và những con số phải thuộc — Phân biệt functional/non-functional requirement, nêu được trade-off của bất kỳ lựa chọn kiến trúc nào, và thuộc ~15 con số latency, powers of two, availability nines để ước lượng trong 30 giây.
- **F2** Ước lượng back-of-envelope: QPS, dung lượng, băng thông, cache — Trong 5 phút tính được QPS trung bình/đỉnh, dung lượng 1–5 năm, băng thông và kích thước cache cho một đề bài bất kỳ, với giả định nói rõ và số làm tròn đúng bậc.
- Mock **M1** Design a URL shortener — làm lạnh, không gợi ý
- Test **KT0** Kiểm tra đầu vào (tuần 1) (30 câu, 30 phút)
- **Mốc:** Lưu KT0 và M1 làm mốc so sánh cho tuần 14 và 24

### Tuần 2
*Mạng và hệ điều hành: chi phí của một request từ DNS tới đĩa.*

- **F3** Mạng cho system design: DNS, TCP/UDP, HTTP/1.1–2–3, TLS, WebSocket/SSE/long polling, CDN — Tính được số RTT của một request HTTPS từ lạnh, chọn đúng giữa polling/long polling/SSE/WebSocket theo bài toán, và kể trọn "what happens when you type a URL" trong 2 phút có số liệu.
- **F4** Máy chủ và hệ điều hành: process/thread/goroutine, I/O, bộ nhớ, đĩa, container limits — Giải thích được vì sao Go phục vụ hàng chục nghìn kết nối với vài thread, đọc được RSS/page cache/cgroup limit của một container, và chẩn đoán được OOM kill ngay cả khi docker inspect báo OOMKilled=false.
- Lab **L1** Đo latency trên máy bạn (3 giờ) — Tự đo được latency RAM/map, SSD, Redis, Postgres, HTTP local bằng Go và lập bảng so với "latency numbers" để có cảm giác số liệu thật.

### Tuần 3
*Cơ sở dữ liệu quan hệ và thiết kế API. Lab: pool, timeout, lock.*

- **F5** Cơ sở dữ liệu quan hệ cốt lõi: index, transaction, isolation, lock, pool, timeout — Đọc được EXPLAIN ANALYZE để chọn đúng index (composite, partial, covering), nêu được anomaly của từng isolation level, và cấu hình pool/statement_timeout đúng tầng (session/role/transaction) cho service Go nối Postgres.
- **F6** Thiết kế API: REST, idempotency, pagination, versioning, lỗi, gRPC/GraphQL, webhook — Thiết kế được một API REST hoàn chỉnh cho tác vụ có side effect: idempotency key cho POST, cursor pagination, error contract có trace id, 202 + job resource cho việc dài, webhook ký HMAC; và nói được khi nào chọn gRPC hay GraphQL thay REST.
- Lab **L2** Connection pool & timeout với pgx (3 giờ) — Tái hiện pool exhaustion, thấy rõ statement_timeout ở session/SET LOCAL/role khác nhau thế nào, dùng lock_timeout và đọc pg_stat_activity như một senior.

### Tuần 4
*Cache và hàng đợi: hai khối xuất hiện trong mọi bài thiết kế.*

- **F7** Caching: chiến lược, TTL, eviction, stampede, hot key, nhất quán — Chọn đúng chiến lược cache cho từng loại dữ liệu, chống được stampede/hot key/penetration bằng kỹ thuật cụ thể (singleflight, jitter, negative cache), và nói rõ cửa sổ không nhất quán mình chấp nhận.
- **F8** Hàng đợi và xử lý bất đồng bộ: delivery semantics, idempotent consumer, DLQ, backpressure, ordering — Phân biệt at-most/at-least/exactly-once và thiết kế được consumer idempotent với DLQ và per-key ordering; giải thích được vì sao publish-before-commit sai, outbox giải quyết thế nào, và alert nào bắt được publisher chết im lặng.
- Lab **L3** Cache-aside Redis + chống stampede (3 giờ) — Cài cache-aside đúng, tái hiện cache stampede với 1000 request đồng thời miss, rồi đưa DB hit về 1 bằng singleflight + lock Redis + TTL jitter và đo p99.

### Tuần 5
*Độ tin cậy và mở rộng. Checkpoint KT1.*

- **F9** Độ tin cậy: availability, SLO/SLI, redundancy, timeout, retry, circuit breaker, graceful degradation — Đặt được SLO với error budget, cấu hình timeout/retry/circuit breaker có số cụ thể cho mọi call ra ngoài, và thiết kế được alert bắt "lỗi im lặng" kiểu publisher chết hay cron lỡ tick.
- **F10** Khả năng mở rộng: stateless, load balancing, scale out DB, autoscaling, giới hạn — Thiết kế được tầng stateless scale ngang sau load balancer với health check và draining, nêu đúng thứ tự scale DB (index → cache → replica → partition → shard), chọn metric autoscaling phù hợp, và giải thích vì sao thêm máy không cho tốc độ tuyến tính.
- Lab **L4** Idempotent consumer RabbitMQ + DLQ + publisher reconnect (4 giờ) — Dựng publisher có confirm và tự reconnect, consumer idempotent bằng dedup table, DLX cho message hỏng; kill broker giữa chừng và chứng minh không mất message, không xử lý trùng.
- Test **KT1** Checkpoint nền tảng (tuần 5) (30 câu, 30 phút)
- **Mốc:** Hết Giai đoạn 1: KT1 ≥ 21/30, 4 lab xong, thẻ D1–D2 ≥ 80% hộp ≥ 3

## Giai đoạn 2 · Khối xây dựng (tuần 6–13)

**Lịch trong tuần (áp dụng cho mọi tuần của giai đoạn):**

- Thứ 2: Bài học 1 của tuần + quiz; Flashcard 10 phút
- Thứ 3: Bài học 2 của tuần + quiz; Oral 5 câu theo topic bài 1
- Thứ 4: Bài học 3 (nếu có) + quiz; không có thì bắt đầu lab; Flashcard 10 phút
- Thứ 5: Lab tuần này (2–3 giờ)
- Thứ 6: Tuần có mock: làm mock LẠNH 45 phút + tự chấm 15 phút. Tuần không mock: viết design doc 1 trang áp dụng khối vừa học vào hệ SBOM (mẫu ở Hướng dẫn → Dùng vào công việc) → ghi Sổ tay
- Thứ 7: Drill trộn 20 câu; Flashcard ôn thẻ đến hạn; Đọc lại Sổ tay tuần này, viết 1 câu "bài học" cho mỗi mục
- Chủ nhật: nghỉ

### Tuần 6
*Load balancer/CDN, replication, sharding.*

- **B1** Load balancer, reverse proxy, API gateway, CDN — Vẽ được lớp biên (edge) của một SaaS: chọn đúng L4/L7, thuật toán cân bằng, health check, nơi kết thúc TLS, cách CDN cache và purge; giải thích được vì sao gọi nội bộ không được đi qua hostname public.
- **B2** Replication: leader-follower, multi-leader, leaderless; sync/async; lag; failover — Chọn được kiểu replication và mức đồng bộ cho một hệ cụ thể, kể tên 3 bất thường do replication lag và cách chặn từng cái, mô tả failover an toàn (fencing) và các tham số Postgres streaming replication hay gây sự cố.
- **B3** Partitioning & sharding: key range, hash, consistent hashing, rebalancing, hot spot, secondary index — Chọn và bảo vệ được shard key cho một hệ multi-tenant, vẽ consistent hashing với virtual node, giải thích rebalancing và hot spot, phân biệt secondary index local/global, và áp dụng declarative partitioning của Postgres cho bảng hàng chục triệu dòng.

### Tuần 7
*NoSQL/LSM và mô hình nhất quán. Mock lạnh M3 (key-value store) ngay sau khi học consistent hashing + quorum.*

- **B4** NoSQL và storage engine: B-tree vs LSM-tree, key-value, wide-column, document, graph — Giải thích được vì sao LSM ghi nhanh đọc chậm hơn B-tree (với số write/read amplification), thiết kế một bảng DynamoDB/Cassandra từ access pattern, và chọn đúng loại store cho từng loại dữ liệu trong một hệ thật kèm cái giá của polyglot persistence.
- **B5** Mô hình nhất quán: linearizability, causal, eventual; CAP/PACELC; quorum N/W/R; version vector; CRDT — Định nghĩa đúng từng mức nhất quán bằng ví dụ hai client, phát biểu CAP và PACELC không sai, tính được quorum N/W/R và chỉ ra khi nào W+R>N vẫn trả dữ liệu cũ, đọc được version vector, chọn CRDT phù hợp, và đặt quy tắc hợp nhất rõ ràng cho dữ liệu dùng chung.
- Lab **L5** Consistent hashing ring (2,5 giờ) — Tự cài vòng consistent hashing có virtual node, đo % key di chuyển khi thêm/bớt node và độ lệch phân bố theo số virtual node, so với hash mod N.
- Mock **M3** Design a key-value store

### Tuần 8
*Consensus, lock phân tán, giao dịch phân tán, outbox. Lab outbox.*

- **B6** Consensus và điều phối: Raft, etcd/ZooKeeper, distributed lock, leader election, lease, fencing token — Giải thích được Raft (term, election, log replication, commit index, 2f+1) trong 3 phút; chọn đúng cơ chế lock/leader election cho job scheduler nhiều instance và nói rõ vì sao Redis lock không đủ cho correctness nếu thiếu fencing token.
- **B7** Giao dịch phân tán: 2PC, saga, outbox, CDC, idempotency, exactly-once — Nhận ra dual write trong code của mình; chọn đúng giữa 2PC, saga và outbox cho từng luồng; thiết kế được outbox + idempotent consumer hoàn chỉnh (bảng, relay, inbox) và nói rõ exactly-once của Kafka bao phủ tới đâu.
- Lab **L6** Outbox pattern Postgres + relay (3,5 giờ) — Cài transactional outbox: ghi order và event cùng transaction, relay poll bằng SKIP LOCKED và publish at-least-once, consumer idempotent; chứng minh không mất và không "publish trước commit".

### Tuần 9
*Broker chuyên sâu và rate limiting. Mock lạnh M2 (rate limiter).*

- **B8** Message broker và streaming chuyên sâu: Kafka, RabbitMQ, SQS/SNS; event-driven; event sourcing; CQRS — Chọn đúng broker cho từng luồng (log phân tán vs queue vs managed pub/sub) và bảo vệ được lựa chọn bằng số liệu; thiết kế publisher/consumer sống sót khi broker restart; phân biệt event notification, event-carried state, event sourcing, CQRS và biết khi nào không dùng.
- **B9** Rate limiting và traffic shaping: token bucket, leaky bucket, fixed/sliding window; phân tán với Redis — So sánh được 5 thuật toán theo bộ nhớ, độ chính xác và burst; viết được token bucket phân tán atomic trên Redis; quyết định đặt limiter ở tầng nào, fail-open hay fail-closed; thiết kế được client-side limiter + concurrency limit + queue leveling cho việc gọi API ngoài.
- Lab **L7** Distributed rate limiter Redis Lua token bucket (3 giờ) — Viết token bucket atomic bằng Lua trên Redis, bọc thành middleware net/http trả 429 + header chuẩn, chạy 2 instance API chung Redis và kiểm chứng bằng hey/k6.
- Mock **M2** Design a distributed rate limiter

### Tuần 10
*ID, thời gian, thứ tự; tìm kiếm và đánh chỉ mục.*

- **B10** Sinh ID duy nhất, thời gian và thứ tự: UUID v4/v7, Snowflake, ULID, ticket server; clock skew, Lamport, HLC — Chọn được kiểu ID cho từng bảng theo 5 tiêu chí (unique, sortable, kích thước, lộ thông tin, sinh offline) và giải thích chi phí index của UUID v4; trình bày Snowflake đến từng bit và cách xử lý clock going backwards; phân biệt wall clock, monotonic clock, Lamport, vector clock, HLC và biết khi nào cần cái nào.
- **B11** Tìm kiếm và đánh chỉ mục: inverted index, Elasticsearch, autocomplete, full-text trong Postgres — Chọn đúng công cụ tìm kiếm cho một bài toán cụ thể (Postgres tsvector/pg_trgm hay Elasticsearch), giải thích được inverted index, relevance BM25, near real-time refresh và cách đồng bộ dữ liệu từ DB sang search index mà không mất dữ liệu.
- Lab **L8** Snowflake ID + ULID (2,5 giờ) — Cài Snowflake 64-bit và ULID, xử lý clock đi lùi, benchmark, kiểm tra tính sortable và đo ảnh hưởng lên index B-tree so với UUIDv4.

### Tuần 11
*Object storage, xử lý dữ liệu lớn, observability. Mock lạnh M5 (notification).*

- **B12** Lưu trữ file và object storage: S3, presigned URL, multipart, dedup, lifecycle, erasure coding — Thiết kế luồng upload/download file qua object storage không đi qua API server (presigned URL, multipart, checksum), chọn lớp lưu trữ theo lifecycle, và giải thích được erasure coding so với replication 3x bằng con số chi phí.
- **B13** Xử lý dữ liệu lớn: batch (MapReduce/Spark), stream (Flink/Kafka Streams), window, watermark, lambda vs kappa; OLTP vs OLAP — Phân biệt batch và stream processing bằng ví dụ cụ thể, giải thích event time vs processing time, window và watermark, chọn được giữa lambda và kappa, và biết khi nào dashboard nên đọc từ OLAP/materialized view thay vì query thẳng DB giao dịch.
- **B14** Observability: log, metric, trace; cardinality; RED/USE; SLO và burn-rate alert; OpenTelemetry; profiling — Thiết kế bộ tín hiệu quan sát cho một dịch vụ (log có cấu trúc, metric đúng kiểu và đúng cardinality, trace có context propagation), đặt alert theo triệu chứng và SLO burn rate, và dùng pprof để tìm nguyên nhân OOM/CPU trong Go.
- Lab **L9** Bloom filter + inverted index mini search (3 giờ) — Tự cài bloom filter và đo false positive thực tế so với công thức, rồi xây inverted index cho 10k document với truy vấn AND/OR và đo latency.
- Mock **M5** Design a notification system

### Tuần 12
*Security, microservices vs monolith, resilience chuyên sâu. Checkpoint KT2.*

- **B15** Bảo mật trong thiết kế: authn, session vs JWT, OAuth2/OIDC, RBAC/ABAC, multi-tenant isolation, TLS/mTLS, secrets, audit — Chọn và bảo vệ được cơ chế xác thực/uỷ quyền phù hợp (session vs JWT, OAuth2 flow, RBAC/ABAC), thiết kế cách ly tenant ở tầng dữ liệu, quản lý secret và audit log đúng cách, và trả lời gọn các câu hỏi bảo mật trong phỏng vấn system design.
- **B16** Microservices vs monolith: ranh giới, giao tiếp, data ownership, API composition, strangler fig, modular monolith — Lập luận được khi nào tách dịch vụ và khi nào không, vẽ ranh giới theo bounded context với data ownership rõ ràng, chọn sync hay async cho từng cạnh giao tiếp, và trình bày kế hoạch strangler fig để tách dần một monolith mà không dừng kinh doanh.
- **B17** Resilience chuyên sâu: timeout hierarchy, retry budget, circuit breaker, bulkhead, load shedding, backpressure, graceful shutdown, chaos — Thiết kế được bộ cơ chế chịu lỗi có thông số cụ thể (timeout lồng nhau, retry budget, circuit breaker, bulkhead, load shedding, backpressure, graceful shutdown) cho một dịch vụ Go, và giải thích vì sao từng cơ chế ngăn một lỗi nhỏ lan thành sự cố toàn hệ.
- Lab **L10** Distributed cron không lỡ tick (3,5 giờ) — Xây scheduler chạy trên 2 instance với lease trong Postgres: đúng 1 instance chạy mỗi tick, kill 1 instance giữa chừng vẫn không double-run và không miss, có catch-up sau downtime.
- Test **KT2** Checkpoint khối xây dựng (tuần 13) (30 câu, 35 phút)

### Tuần 13
*Deploy/vận hành, SaaS multi-tenant, realtime. Mock lạnh M6 (news feed).*

- **B18** Triển khai và vận hành: rolling/blue-green/canary, feature flag, schema migration expand-contract, container/K8s cơ bản, serverless trade-off, IaC — Chọn chiến lược deploy phù hợp với rủi ro và chi phí, viết được kế hoạch schema migration không downtime theo expand-contract, nêu đúng các khái niệm K8s/serverless cần cho phỏng vấn, và nhận diện các lỗi vận hành (config drift, image không pin, không có memory limit) từ sự cố thật.
- **B19** Kiến trúc SaaS multi-tenant: mô hình tenancy, noisy neighbor, quota, cách ly dữ liệu, cache theo tenant, metering — So sánh ba mô hình tenancy bằng con số và chọn đúng cho từng lớp dữ liệu, thiết kế tenant context propagation và fairness trong pipeline nền để một tenant không chiếm hết hệ thống, và nêu được cách xử lý dữ liệu dùng chung, metering, onboarding/offboarding.
- **B20** Giao tiếp thời gian thực: WebSocket ở quy mô lớn, pub/sub fan-out, presence, push notification, SSE — Thiết kế được lớp WebSocket gateway stateful scale ngang (connection registry, pub/sub routing, heartbeat/reconnect), chọn đúng giữa WebSocket/SSE/long polling/push, và giải thích fan-out, presence, ordering/dedup bằng con số.
- Mock **M6** Design a news feed
- **Mốc:** Hết Giai đoạn 2: KT2 ≥ 22/30, 4 mock trung bình ≥ 8/15, 6 lab

## Giai đoạn 3 · Bài toán kinh điển (tuần 14–20)

**Lịch trong tuần (áp dụng cho mọi tuần của giai đoạn):**

- Thứ 2: Mock LẠNH 45 phút đề của tuần, KHÔNG đọc case trước, không mở gợi ý; tự chấm 15 phút và lưu
- Thứ 3: Đọc case tương ứng với mock hôm qua; ghi 3 khác biệt lớn nhất giữa bài bạn và lời giải vào Sổ tay; Quiz case
- Thứ 4: Case thứ 2 của tuần: đọc + quiz; tự vẽ lại sơ đồ từ trí nhớ sau khi đóng bài
- Thứ 5: Case thứ 3 của tuần (hoặc lab nếu tuần có lab)
- Thứ 6: Làm lại mock đầu tuần bản rút gọn 30 phút (chỉ thiết kế tổng thể + đào sâu) HOẶC ghi âm 10 phút trình bày thiết kế bằng tiếng Anh, nghe lại; Áp dụng: 1 việc thật ở công ty → Sổ tay
- Thứ 7: Oral 10 câu trộn; Flashcard ôn thẻ đến hạn; Drill 20 câu
- Chủ nhật: nghỉ

### Tuần 14
*Làm lại M1 lạnh rồi so với tuần 1. Đọc C1–C3 sau khi làm.*

- **C1** Case: Design a URL shortener (TinyURL) — Trình bày trọn bài URL shortener trong 45 phút: ước lượng 100M URL/tháng ra QPS và dung lượng, chọn cách sinh short key có lý do, giải thích 301 vs 302 và pipeline analytics bất đồng bộ.
- **C2** Case: Design a distributed rate limiter — Chọn đúng thuật toán rate limit theo yêu cầu, viết được script Redis Lua atomic, giải thích đặt limiter ở đâu, đồng bộ nhiều node ra sao, và quyết định fail-open hay fail-closed khi Redis chết.
- **C3** Case: Design a key-value store (Dynamo-style) — Thiết kế được KV store phân tán kiểu Dynamo: consistent hashing với virtual node, replication N và quorum W/R, vector clock, hinted handoff, Merkle tree, gossip, và giải thích write/read path trên LSM tree.
- Lab **L11** Load test + pprof tìm bottleneck (4 giờ) — Dùng k6 và pprof tìm ra endpoint Preload toàn bộ dữ liệu (sự cố #3), sửa thành stream/paginate có giới hạn concurrency, so sánh RSS và p99 trước/sau, đặt memory limit + GOMEMLIMIT.
- Mock **M1** Design a URL shortener
- **Mốc:** M1 lần 2 hơn baseline ≥ 4 điểm; nếu không, đọc lại F2, F7, B3

### Tuần 15
*Mock lạnh M7 (chat). Case: ID generator, notification, news feed.*

- **C4** Case: Design a unique ID generator in distributed systems — So sánh được multi-master increment, UUID, ticket server và Snowflake; trình bày bit layout Snowflake, xử lý clock backwards, và giải thích vì sao id sắp xếp theo thời gian tốt cho index B-tree.
- **C5** Case: Design a notification system (push, SMS, email) — Thiết kế hệ gửi thông báo đa kênh với queue theo kênh, retry và DLQ, rate limit theo provider, dedup và idempotency, user preference; nối thẳng sang pipeline notification của hệ SBOM.
- **C6** Case: Design a news feed (Facebook, Twitter) — Giải thích và chọn giữa fan-out on write, fan-out on read và hybrid cho celebrity; thiết kế feed cache bằng Redis, luồng đăng bài và đọc feed, ước lượng cho 300M DAU và nêu điểm nghẽn.
- Mock **M7** Design a chat system

### Tuần 16
*Mock lạnh M10 (cloud storage). Case: chat, autocomplete, video.*

- **C7** Case: Design a chat system (WhatsApp, Messenger) — Thiết kế chat 1-1 và nhóm với WebSocket gateway, service discovery, message store wide-column, thứ tự message, presence, receipts, offline push, multi-device sync và phác hoạ end-to-end encryption.
- **C8** Case: Design a search autocomplete (typeahead) — Thiết kế typeahead trả top-k gợi ý trong dưới 100 ms: trie với top-k tính trước, shard theo prefix, pipeline gom log → trie builder → snapshot, cache nhiều tầng, cập nhật offline vs trending realtime, lọc nội dung.
- **C9** Case: Design a video streaming platform (YouTube) — Thiết kế upload presigned và resumable, pipeline transcoding dạng DAG song song theo độ phân giải, adaptive bitrate với HLS/DASH qua CDN, metadata DB, view count bất đồng bộ, và lập luận chi phí CDN vs storage.
- Mock **M10** Design a cloud file storage

### Tuần 17
*Mock lạnh M11 (payment). Case: drive, payment, metrics.*

- **C10** Case: Design a cloud file storage (Google Drive, Dropbox) — Thiết kế đồng bộ file: chunking block-level với dedup và delta sync, metadata DB strong consistency, notification service cho sync, conflict resolution, offline queue, cold storage và chia sẻ quyền.
- **C11** Case: Design a payment system — Thiết kế được hệ thống thanh toán qua PSP với ledger double-entry append-only, idempotency end-to-end, webhook + reconciliation, và lý giải vì sao chọn consistency thay vì availability.
- **C12** Case: Design a metrics monitoring and alerting system — Thiết kế được pipeline metric (pull/push → Kafka → TSDB hot/cold), ước lượng cardinality, nén và downsampling bằng số, và thiết kế alert manager có for-duration, dedup, silence, route và alert "không có dữ liệu".
- Mock **M11** Design a payment system

### Tuần 18
*Mock lạnh M14 (proximity). Case: ad aggregation, proximity, message queue. Bắt đầu capstone L12.*

- **C13** Case: Design an ad click event aggregation system — Thiết kế được pipeline Kafka → Flink window 1 phút → OLAP với exactly-once hiệu quả bằng dedup + idempotent write, xử lý late event bằng watermark, và giữ raw data để reconcile; so sánh lambda và kappa.
- **C14** Case: Design a proximity service (Yelp nearby search) — Thiết kế được dịch vụ tìm địa điểm gần đây với geohash (so sánh quadtree, S2), tách business service khỏi location service đọc nhiều, cache theo ô geohash, và mở rộng sang nearby friends với WebSocket + Redis pub/sub.
- **C15** Case: Design a distributed message queue (Kafka-like) — Thiết kế được message queue phân tán với topic/partition, segment log append-only + index, replication leader/ISR, consumer group và offset, coordinator; giải thích push vs pull, delivery semantics, retention và rebalancing bằng số.
- Lab **L12** Capstone: mini SBOM pipeline (4 giờ (có thể chia 2 buổi)) — Ghép mọi pattern đã học thành pipeline upload → queue → enrich gọi API giả có lỗi/rate limit → isolate per item, retry/backoff, DLQ, status machine, sweeper fair theo tenant, metric Prometheus + alert "no success 5 phút".
- Mock **M14** Design a proximity service (nearby search)

### Tuần 19
*Mock lạnh M16 (booking) và M18 (scheduler). Case: booking, crawler, job scheduler.*

- **C16** Case: Design a hotel reservation system — Thiết kế được hệ đặt phòng với bảng inventory theo ngày, chống double booking bằng ba cách (pessimistic, optimistic, constraint) và chọn đúng, overbooking có kiểm soát, reservation hold/expire, idempotent booking, ranh giới microservice và sharding theo hotel_id.
- **C17** Case: Design a web crawler — Thiết kế được crawler 1 tỷ trang/tháng với URL frontier có priority và politeness per host, dedup URL bằng Bloom filter và nội dung bằng SimHash, robots.txt, trap detection, frontier phân tán shard theo host, và lịch recrawl theo freshness.
- **C18** Case: Design a distributed job scheduler (cron as a service) — Thiết kế được job scheduler phân tán không lỡ tick khi redeploy và không double-run: job store persist next_run_at, partition hoặc leader election, lease + heartbeat, at-least-once + idempotent, misfire policy, retry/backoff, DLQ, history; biết khi nào Postgres SKIP LOCKED là đủ.
- Mock **M16** Design a hotel reservation system
- Mock **M18** Design a distributed job scheduler

### Tuần 20
*Capstone: thiết kế lại hệ SBOM của chính bạn (M19 rồi đọc C19). Hoàn thành L12. Checkpoint KT3.*

- **C19** Case: Design an SBOM analysis platform (capstone) — Thiết kế lại từ đầu hệ thống bạn đang làm như một bài phỏng vấn: multi-tenant upload SBOM lớn, component store dùng chung + overlay per-tenant, enrichment pipeline gọi API ngoài có politeness và isolate lỗi, sweeper công bằng, policy eval incremental với atomic swap, scheduler persist, outbox, observability và capacity; mỗi quyết định gắn với một sự cố thật.
- Mock **M19** Design an SBOM analysis platform
- Test **KT3** Checkpoint case study (tuần 20) (30 câu, 35 phút)
- **Mốc:** Hết Giai đoạn 3: KT3 ≥ 24/30, mock trung bình ≥ 10/15, L12 chạy được

## Giai đoạn 4 · Phỏng vấn & thực chiến (tuần 21–24)

**Lịch trong tuần (áp dụng cho mọi tuần của giai đoạn):**

- Thứ 2: Bài K của tuần + quiz; Oral 10 câu (ưu tiên topic yếu từ KT gần nhất)
- Thứ 3: Mock đề LẠ 45 phút + tự chấm; đọc reference, ghi khác biệt
- Thứ 4: Bài K tiếp theo + quiz; Viết hoặc tập kể 1 câu chuyện STAR (ghi âm 2 phút)
- Thứ 5: Bài K tiếp theo hoặc 3 bài SQL/LLD trong K3/K4
- Thứ 6: Mock thứ 2 trong tuần hoặc làm lại mock có điểm thấp nhất; Áp dụng: 1 việc thật → Sổ tay
- Thứ 7: Tuần có KT: làm KT bấm giờ. Không có: drill 30 câu; Flashcard ôn thẻ đến hạn; Đọc lại toàn bộ Sổ tay, chọn 6 mục thành câu chuyện STAR
- Chủ nhật: nghỉ

### Tuần 21
*Go, concurrency, SQL thực chiến. Hai đề lạ X1, X2.*

- **K1** Go cho phỏng vấn backend — Trả lời trôi chảy 15 câu hỏi Go hay gặp nhất (goroutine, channel, context, sync, memory model, slice/map/interface bẫy, GC, pprof) kèm câu vặn tiếp theo, và chỉ ra được 3 lỗi Go đã gây sự cố thật trong worker SBOM.
- **K2** Bài toán đồng thời — Định nghĩa và phân biệt race/deadlock/livelock/starvation, giải 5 tình huống đồng thời kinh điển bằng pattern đúng (bounded channel, lock ordering, CAS, singleflight, semaphore, SKIP LOCKED) và nói được vì sao retry song song đòi hỏi idempotency.
- **K3** SQL và Postgres thực chiến — Viết đúng 6 dạng SQL hay hỏi (window, CTE đệ quy, EXISTS, HAVING, LAG, keyset), đọc được EXPLAIN ANALYZE để nói vì sao index không được dùng, và giải thích 5 sự cố Postgres thật (partial index, FDW, statement_timeout, bloat, deadlock).
- Mock **X1** Design a flash-sale / high-concurrency ticketing system
- Mock **X2** Design a collaborative document editor (Google Docs)

### Tuần 22
*LLD/OOD, networking, OS. Đề lạ X3, X4.*

- **K4** Low-level design / OOD — Trình bày một bài LLD 30 phút theo khung requirements → entities → interfaces → core algorithm → extensibility; viết được LRU cache O(1), rate limiter object và pub/sub in-process bằng Go; giải thích SOLID và 7 pattern bằng ví dụ Go idiomatic.
- **K5** Networking Q&A — Kể trọn vẹn "what happens when you type a URL" trong 3 phút, giải thích TIME_WAIT/ephemeral port và vì sao phải có connection pool, so sánh HTTP/1.1–2–3, TLS 1.3, L4/L7, và chẩn đoán được lỗi hairpin NAT đã gặp trên pilot.
- **K6** Operating system Q&A — Giải thích bằng ngôn ngữ vận hành: RSS vs heap, page cache và "free thấp là bình thường", OOM killer global vs cgroup (vì sao OOMKilled=false), CPU throttling, epoll vs io_uring, fsync/WAL, container = namespace + cgroup + overlayfs, và quy trình SIGTERM → drain.
- Mock **X3** Design a log aggregation and search platform (ELK-like)
- Mock **X4** Design a multi-tenant issue tracker like Backlog/Jira

### Tuần 23
*Cloud, testing, behavioral STAR, postmortem. Đề lạ X5 + làm lại mock điểm thấp nhất.*

- **K7** Cloud/AWS cho thiết kế — Chọn đúng compute (EC2/ECS/Lambda), queue (SQS/SNS/EventBridge/Kinesis) và DB (Aurora/DynamoDB) cho một bài system design với lý do bằng số (cold start, timeout, giới hạn, chi phí), nói được IAM least privilege, và rút bài học từ sự cố Lambda mất env.
- **K8** Testing & chất lượng trong hệ phân tán — Lập chiến lược test cho một service Go có DB/queue/API ngoài: table-driven unit, integration bằng testcontainers, contract test, test idempotency/retry/trùng thứ tự, load test k6 với threshold, soak test tìm leak, chaos test cho reconnect; và nói về testing một cách thuyết phục trong phỏng vấn system design.
- **K9** Behavioral & STAR cho kỹ sư backend — Có sẵn 6 câu chuyện STAR(R) 90 giây từ sự cố thật, mỗi câu chuyện có số liệu và bài học, map được vào 8 câu hỏi behavioral hay gặp, tránh 5 red flag, và chuẩn bị 8 câu hỏi ngược cho interviewer.
- **K10** Phân tích sự cố & postmortem — Viết được một postmortem blameless hoàn chỉnh (timeline, detection, root cause + contributing factors, action items SMART, MTTD/MTTR), kể lại một sự cố trong 2 phút ở phỏng vấn, và biến mỗi sự cố thành 1–2 đề xuất thiết kế có thể kiểm chứng.
- Mock **X5** Design a CI license-compliance scanner SaaS

### Tuần 24
*Design doc/ADR và ngày phỏng vấn. Đề lạ X6 + mô phỏng vòng đầy đủ: KT4 40 phút → mock 45 phút → 6 câu behavioral 30 phút.*

- **K11** Design doc, ADR và capacity planning trong công việc thật — Viết được design doc 1–2 trang và ADR theo template, lập capacity plan 12 tháng bằng bảng, chạy production readiness review với checklist, review design của người khác bằng 10 câu hỏi, và thuyết phục bằng số liệu đo trước khi sửa.
- **K12** Ngày phỏng vấn system design — Vào phòng phỏng vấn với kế hoạch 45 phút rõ ràng, dẫn dắt được cuộc hội thoại (nói to suy nghĩ, xác nhận, không im lặng quá 30 giây), xử lý câu hỏi không biết bằng khung an toàn, phát tín hiệu senior, và thuộc 40 câu tiếng Anh theo từng pha.
- Mock **X6** Design a ride-hailing dispatch (nearby drivers + matching)
- Test **KT4** Tổng duyệt trước phỏng vấn (tuần 24) (30 câu, 40 phút)
- **Mốc:** Hết lộ trình: KT4 ≥ 26/30, đề lạ trung bình ≥ 11/15, 6 câu chuyện STAR, sổ tay ≥ 20 mục

## Đề mock lạ (Giai đoạn 4)
- **X1** Design a flash-sale / high-concurrency ticketing system (mức 3)
- **X2** Design a collaborative document editor (Google Docs) (mức 3)
- **X3** Design a log aggregation and search platform (ELK-like) (mức 2)
- **X4** Design a multi-tenant issue tracker like Backlog/Jira (mức 2)
- **X5** Design a CI license-compliance scanner SaaS (mức 2)
- **X6** Design a ride-hailing dispatch (nearby drivers + matching) (mức 3)

## Cách làm đề (tóm tắt)

Khung 5 pha, 45 phút: làm rõ yêu cầu 5' → ước lượng 5' → thiết kế tổng thể 12' → đào sâu 18' → tổng kết 5'. Tự chấm 5 tiêu chí × 0–3:

- **Làm rõ yêu cầu & phạm vi**: 0 = Nhảy thẳng vào giải pháp, không hỏi gì; 3 = Chốt rõ và nêu được thứ tự ưu tiên (ví dụ đúng đắn hơn độ trễ) rồi dùng nó để quyết định ở các pha sau
- **Ước lượng & số liệu**: 0 = Không có con số nào; 3 = Số liệu dẫn tới quyết định cụ thể (cần shard chưa, cache bao nhiêu GB, bao nhiêu partition)
- **Thiết kế tổng thể**: 0 = Thiếu thành phần cốt lõi hoặc luồng sai; 3 = Thiết kế đơn giản nhất đáp ứng yêu cầu; nói rõ vì sao không phức tạp hơn; chỉ ra điểm nghẽn trước khi bị hỏi
- **Đào sâu & trade-off**: 0 = Chỉ nêu tên công nghệ; 3 = Đào sâu đúng điểm nóng người phỏng vấn quan tâm; nêu cả cách vận hành (monitor, rollback, migration)
- **Giao tiếp & dẫn dắt**: 0 = Im lặng lâu, lan man, không theo thời gian; 3 = Dẫn dắt như buổi review thật: tóm tắt từng pha, hỏi ưu tiên, thừa nhận điều chưa chắc và nói cách kiểm chứng

Chi tiết, bộ câu hỏi làm rõ, công thức ước lượng, prompt dùng AI làm người phỏng vấn: trong app → Hướng dẫn → Cách làm đề.
