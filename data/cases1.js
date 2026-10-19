/* ===== cases1.js — 10 bài case C1–C10 (URL shortener, rate limiter, KV store, ID generator,
   notification, news feed, chat, typeahead, video streaming, cloud file storage) + 10 đề mock M1–M10.
   Mỗi bài case theo khung 6 mục (Đề bài → Làm rõ → Ước lượng → HLD → Đào sâu → Trade-off → Chấm điểm). ===== */
window.LESSONS_C1 = [
{ id: 'C1', type: 'case', topic: 'api', title: 'Case: Design a URL shortener (TinyURL)', time: '90 phút',
  goal: 'Trình bày trọn bài URL shortener trong 45 phút: ước lượng 100M URL/tháng ra QPS và dung lượng, chọn cách sinh short key có lý do, giải thích 301 vs 302 và pipeline analytics bất đồng bộ.',
  md: `
## Đề bài
> "Design a URL shortening service like TinyURL. Users submit a long URL and get back a short one; anyone opening the short link gets redirected to the original. Assume about 100 million new URLs per month."

Dịch: thiết kế dịch vụ rút gọn URL kiểu TinyURL; user gửi URL dài nhận URL ngắn; ai mở link ngắn thì được chuyển hướng về URL gốc; khoảng 100 triệu URL mới mỗi tháng. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
Câu hỏi nên hỏi và câu trả lời giả định:
- Hỏi: Tỉ lệ đọc/ghi? → Đáp: khoảng 10:1, redirect nhiều hơn tạo link rất nhiều.
- Hỏi: Short key dài bao nhiêu, dùng ký tự gì? → Đáp: càng ngắn càng tốt, chữ cái và số là đủ.
- Hỏi: Có cho user tự đặt alias không? → Đáp: có, tuỳ chọn.
- Hỏi: Link có hết hạn không? → Đáp: mặc định 5 năm, user có thể đặt ngắn hơn.
- Hỏi: Cần thống kê click không, realtime không? → Đáp: cần tổng click và theo quốc gia, gần đúng là được, trễ vài phút.
- Hỏi: Có xoá hay sửa đích không? → Đáp: xoá có, sửa đích không.

Chốt lại:
**Functional**
- Tạo short URL từ long URL, kèm alias và TTL tuỳ chọn.
- Redirect short URL về long URL.
- Thống kê click cơ bản theo link.
- Xoá link.

**Non-functional**
- Redirect p99 dưới 50 ms phía server, vì nó nằm trên đường đi của mọi click.
- Sẵn sàng 99,99% cho redirect; tạo link chỉ cần 99,9%.
- Short key tuyệt đối không trùng (trùng = trả nhầm link cho người khác = sự cố bảo mật).
- Scale: 100M URL/tháng, lưu 5 năm.

**Ngoài phạm vi**: quản lý tài khoản chi tiết, chống phishing nâng cao, QR code, link preview.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Ghi (tạo link) | 100M / (30 ngày × 86 400 s) ≈ 100M / 2,6M s | ≈ 40 QPS, đỉnh ×3 ≈ 120 QPS |
| Đọc (redirect) | 40 × 10 | ≈ 400 QPS, đỉnh ≈ 1 200 QPS |
| Số URL sau 5 năm | 100M × 12 × 5 | 6 tỷ bản ghi |
| Kích thước 1 bản ghi | key 7 B + long URL ~200 B + metadata ~100 B | ≈ 300–500 B |
| Dung lượng 5 năm | 6 tỷ × 500 B | ≈ 3 TB |
| Băng thông đọc | 400 × 500 B | ≈ 200 KB/s, không đáng kể |
| Cache 20% link nóng mỗi ngày | 400 × 86 400 × 0,2 × 500 B | ≈ 3,5 GB, một Redis node là đủ |

Độ dài key: bảng chữ base62 (a–z, A–Z, 0–9). 6 ký tự → 62^6 ≈ 56,8 tỷ; 7 ký tự → 62^7 ≈ 3,5 nghìn tỷ. Cần 6 tỷ key nên 6 ký tự đủ về mặt số học, nhưng chọn **7** để còn dư chỗ cho alias, cho key bỏ đi và để khó dò hơn.

Rút ra: hệ **đọc nhiều, ghi ít, dữ liệu nhỏ nhưng rất nhiều dòng**. Bài toán không phải throughput mà là **cách sinh key không trùng** và **độ trễ redirect**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Browser/App] -> LB[Load balancer] : HTTPS
LB -> API[API server Go]
API -> Cache[Redis short to long] : cache-aside
API -> DB[Postgres partition hoặc KV store]
API -> KGS[Key generator cấp range]
API -> MQ[Kafka topic clicks] : publish click, không chờ
MQ -> Agg[Analytics worker]
Agg -> OLAP[ClickHouse]
OLAP -> Stats[Stats API]
:::

**Luồng ghi**: client POST long URL → API validate URL (scheme, độ dài) → lấy key từ range đang giữ trong RAM (mục 4.1) → INSERT (short_key, long_url, user_id, expires_at) → trả 201 kèm short URL. Nếu có alias: INSERT với unique constraint trên short_key, trùng → 409.

**Luồng đọc**: GET /{key} → Redis GET → miss thì đọc DB rồi SET cache với TTL = min(expires_at, 24 h) → trả 302 với Location = long_url. Đồng thời publish event click vào queue, không đợi kết quả. Worker gom theo phút và ghi vào OLAP.

API chính:
| Method | Path | Mô tả |
|---|---|---|
| POST | /api/v1/urls | body long_url, alias tuỳ chọn, expires_at tuỳ chọn → 201 short_url |
| GET | /{key} | 302 redirect; 404 nếu không có; 410 nếu hết hạn hoặc đã xoá |
| DELETE | /api/v1/urls/{key} | soft delete, xoá cache |
| GET | /api/v1/urls/{key}/stats | tổng click, theo ngày, theo quốc gia |

Mô hình dữ liệu:
| Bảng | Khoá | Cột chính |
|---|---|---|
| urls | PK short_key varchar(7) | long_url, user_id, created_at, expires_at, deleted_at |
| click_events (OLAP) | (short_key, ts) | country, user_agent, referrer |
| key_ranges | range_id | range_start, range_end, assigned_to, assigned_at |

Chọn DB: dữ liệu phẳng, truy vấn chỉ theo PK → KV store (DynamoDB, Cassandra) hoặc Postgres partition theo hash(short_key) đều được. 3 TB với 1 cụm Postgres có replica vẫn ổn; nói rõ ngưỡng chuyển sang KV là khi ghi vượt vài nghìn QPS hoặc cần multi-region.

## 4. Đào sâu (15–18 phút)
### 4.1 Sinh short key: hash hay counter?
Vấn đề: key 7 ký tự, duy nhất, không tuần tự lộ liễu, sinh được trên nhiều API node mà không khoá nhau.
| Phương án | Cách làm | Ưu | Nhược |
|---|---|---|---|
| Hash rồi cắt | MD5(long_url) → base62 → lấy 7 ký tự đầu | Không cần state; cùng URL ra cùng key | Cắt chuỗi gây **collision**, phải check DB rồi thêm salt thử lại; write path phụ thuộc DB |
| Counter toàn cục + base62 | Redis INCR hoặc DB sequence → base62 | Không bao giờ trùng, 7 ký tự dư sức | Counter là điểm nghẽn và SPOF; key tuần tự nên đoán được link người khác |
| KGS cấp range | KGS phát cho mỗi API node 1 range (ví dụ 10 000 key), node tự tăng trong RAM | Không trùng, không gọi KGS mỗi request, scale ngang | Mất range khi node chết (chấp nhận được vì 62^7 quá dư) |
| Pre-generate pool | Sinh sẵn key ngẫu nhiên vào bảng unused_keys, API lấy ra và đánh dấu | Key ngẫu nhiên, không trùng | Hai bảng phải đồng bộ, lấy key cần lock hoặc DELETE RETURNING |

Chọn: **KGS cấp range + base62**, và **hoán vị bit** (XOR với hằng số rồi đảo bit) trước khi encode để key không tuần tự. Lý do: hash tiết kiệm state nhưng biến write path thành vòng lặp check collision; counter theo range cho đúng đắn theo cấu trúc, không cần kiểm tra.

### 4.2 301 hay 302?
| Mã | Trình duyệt làm gì | Hệ quả |
|---|---|---|
| 301 Moved Permanently | cache vĩnh viễn, lần sau không gọi server | Giảm tải server nhưng **mất analytics**, không thu hồi hay đổi đích được |
| 302 Found (hoặc 307) | không cache, lần nào cũng gọi | Đếm được click, xoá link có hiệu lực ngay; tốn thêm tải nhưng chỉ cỡ 400 QPS |

Chọn 302 vì đề cần analytics. Nếu người phỏng vấn đổi đề "không cần thống kê, tối ưu chi phí" thì 301 là đúng.

### 4.3 Redirect nhanh: cache và hot key
- Cache-aside Redis, key = short_key, value = long_url. Click tuân theo phân phối lệch (số ít link chiếm đa số click) nên hit ratio kỳ vọng trên 90%.
- Link viral hàng chục nghìn QPS vào 1 key: Redis 1 node chịu khoảng 100k GET nhỏ mỗi giây nên vẫn ổn, nhưng thêm **local cache in-process** 1–5 giây ở API để không dồn về 1 shard Redis.
- Key không tồn tại bị dò liên tục: cache negative với TTL 1 phút, hoặc **Bloom filter** các key đã cấp để chặn trước khi tới DB.

### 4.4 Analytics bất đồng bộ
Redirect không bao giờ chờ ghi thống kê. API publish event (key, ts, country từ IP, user agent) vào queue; worker gom theo phút rồi ghi OLAP. Mất vài event khi worker chết là chấp nhận được vì đề nói "gần đúng". Nếu cần chính xác: Kafka với acks=all và consumer idempotent theo event_id.

### 4.5 Expiry và dọn dẹp
Không chạy cron DELETE quét cả bảng 6 tỷ dòng. Đọc tới link hết hạn → trả 410 và xoá lazy. Partition bảng urls theo tháng của expires_at → dọn bằng DROP partition, gần như miễn phí.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Hai user rút gọn cùng một long URL thì sao?" → Với counter, mỗi lần ra key khác; đơn giản và cho phép thống kê riêng. Nếu muốn dedup theo user: index (user_id, md5(long_url)).
2. "KGS chết thì sao?" → API còn range trong RAM đủ chạy hàng giờ; KGS chạy 2 bản, cấp range từ DB sequence nên 2 bản không cấp trùng.
3. "Làm sao chống đoán key tuần tự?" → Hoán vị bit trước khi base62 hoặc trộn vài bit ngẫu nhiên; không gian 62^7 nên dò ngẫu nhiên gần như vô vọng.
4. "Nếu ghi tăng lên 100k QPS?" → Shard DB theo hash(short_key), KGS cấp range lớn hơn, Redis cluster; API stateless nên chỉ thêm node.
5. "Xoá link rồi mà cache còn trả link cũ?" → Xoá DB xong thì DEL cache; cửa sổ vài ms chấp nhận được. Nếu đã dùng 301 thì không thu hồi được trên trình duyệt đã cache.
6. "Custom alias trùng key tự sinh?" → Cùng namespace, unique constraint trên short_key; key tự sinh đụng alias thì lấy key tiếp theo trong range (hiếm vì alias thường dài hơn 7).
7. "Chống phishing và spam?" → Kiểm tra URL với danh sách đen, rate limit theo user và IP, trang cảnh báo trung gian cho link mới tạo có nhiều click bất thường.
8. "Đo gì để biết hệ khoẻ?" → p99 redirect, cache hit ratio, tỉ lệ 404/410, queue lag analytics, số range còn lại trong KGS.

### Sai lầm hay gặp
- Nhảy ngay vào "MD5 cắt 7 ký tự" mà không nói collision xử lý thế nào.
- Chọn 301 vì "chuẩn hơn" rồi không giải thích được vì sao analytics bằng 0.
- Ghi click đồng bộ vào DB trong redirect, khiến p99 redirect phụ thuộc DB.
- Ước lượng dung lượng ra hàng PB vì quên mỗi dòng chỉ cỡ 500 B.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Làm rõ yêu cầu | Vẽ sơ đồ ngay | Hỏi tỉ lệ đọc/ghi, alias, TTL, analytics rồi mới chốt |
| Ước lượng | Nói "rất nhiều request" | 40 QPS ghi, 400 QPS đọc, 3 TB cho 5 năm, 7 ký tự base62 |
| Sinh key | Một phương án, không trade-off | So sánh hash, counter, KGS; chọn và nêu điểm yếu của lựa chọn |
| Redirect | Chỉ nói "dùng cache" | 302 vs 301, cache-aside, hot key, negative cache |
| Vận hành | Bỏ qua | Metrics, expiry theo partition, chống dò và spam |

### Nói thế nào trong phỏng vấn (EN)
- "This is a read-heavy system, roughly ten to one, so I will optimize the redirect path first." — Hệ đọc nhiều, tối ưu đường redirect trước.
- "I would use a range-based counter encoded in base62 rather than hashing, because it avoids collisions by construction." — Dùng counter theo range + base62, không trùng về bản chất.
- "I would return 302 instead of 301 so we keep analytics and can revoke links." — Trả 302 để giữ analytics và thu hồi được.
- "Click tracking is fire-and-forget to a queue; the redirect never waits on it." — Ghi click bất đồng bộ, redirect không chờ.
- "With 62 to the power of 7 we have about 3.5 trillion keys, so losing a few ranges when a node dies is fine." — 62^7 ≈ 3,5 nghìn tỷ key nên mất vài range không sao.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Link tải export (CSV, SPDX, PDF) của bạn hiện trả thẳng file qua API. Mẫu "short key → 302 sang presigned URL MinIO/S3" giúp API không stream file qua RAM (sự cố export ReadAll vào RAM) và còn đếm được lượt tải.
- Sinh id: bảng t_resource_instances, t_project_revisions dùng UUID ngẫu nhiên. Bài này cho thấy counter theo range (hoặc UUID v7) cho id vừa duy nhất vừa gọn; nối sang C4.
- Cache-aside Redis cho lookup nóng: license theo purl, CVE theo id. Hiện tại Redis của bạn chủ yếu làm L1 cho enrichment; áp dụng thêm negative cache để bớt gọi ClearlyDefined cho coordinate không tồn tại.
- Analytics bất đồng bộ qua queue chính là mẫu audit log của bạn; nhớ sự cố publish trước khi commit: ở đây event click độc lập với transaction nên không sao, nhưng audit log thì phải publish sau commit (xem C5).
- Việc tuần này: đo p99 của endpoint tải file và số lần export trùng trong 1 giờ; nếu cao, đề xuất ADR "export sinh một lần, lưu S3, trả 302" với TTL 24 h.
- Câu chuyện phỏng vấn: bạn đã gặp partition theo thời gian giúp dọn dữ liệu cũ bằng DROP thay vì DELETE hàng triệu dòng; dùng lại ý này khi nói về expiry.
`,
  quiz: [
    { t: 'mc', q: 'Với 100M URL/tháng, QPS ghi trung bình xấp xỉ bao nhiêu?', o: ['4 QPS', '40 QPS', '400 QPS', '4 000 QPS'], a: 1, why: '100M / (30 × 86 400 s) ≈ 100M / 2,6M s ≈ 40 QPS.' },
    { t: 'mc', q: 'Vì sao chọn 302 thay vì 301 cho redirect khi đề yêu cầu thống kê click?', o: ['302 nhanh hơn 301 về mặt mạng', '302 cho phép cache CDN tốt hơn', '301 không hợp lệ với HTTPS', '301 bị trình duyệt cache vĩnh viễn nên các lần sau không gọi server, mất analytics'], a: 3, why: '301 bị cache vĩnh viễn phía client, server không còn thấy click và cũng không thu hồi link được.' },
    { t: 'mc', q: 'Nhược điểm chính của cách sinh key bằng hash(long_url) rồi cắt 7 ký tự là gì?', o: ['Key quá dài', 'Không chạy được trên nhiều node', 'Collision khi cắt chuỗi, phải kiểm tra DB và thử lại', 'Không hỗ trợ alias'], a: 2, why: 'Cắt hash làm mất tính duy nhất; write path phải kiểm tra DB và thêm salt khi trùng.' },
    { t: 'mc', q: 'Key Generation Service cấp range cho từng API node giải quyết điều gì?', o: ['Tránh gọi counter trung tâm mỗi request mà vẫn không trùng key', 'Giảm dung lượng lưu trữ', 'Cho phép key ngẫu nhiên hoàn toàn', 'Thay thế hoàn toàn cache'], a: 0, why: 'Node tự tăng trong range đã nhận, chỉ gọi KGS khi hết range; không trùng vì các range rời nhau.' },
    { t: 'mc', q: 'Cách hợp lý nhất để dọn 6 tỷ dòng URL hết hạn là gì?', o: ['Cron DELETE WHERE expires_at < now() mỗi đêm', 'Partition theo tháng của expires_at và DROP partition cũ, kết hợp xoá lazy khi đọc', 'Để DB tự dọn', 'Xoá cache là đủ'], a: 1, why: 'DELETE hàng tỷ dòng rất đắt; DROP partition gần như tức thì, xoá lazy xử lý phần còn lại.' },
    { t: 'fill', q: 'Điền: với bảng chữ 62 ký tự, 7 ký tự cho khoảng 3,5 ___ tổ hợp key.', a: ['nghìn tỷ', 'nghin ty', 'trillion', '3.5 trillion'], why: '62^7 ≈ 3,52 × 10^12 = 3,5 nghìn tỷ.' },
    { t: 'fill', q: 'Điền: để chặn request dò key không tồn tại trước khi tới DB, có thể dùng ___ filter cho tập key đã cấp.', a: ['bloom', 'bloom filter'], why: 'Bloom filter trả lời chắc chắn "không có" với bộ nhớ rất nhỏ, chỉ có false positive.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Một link bỗng viral, 50 000 QPS vào đúng một key. Hệ của bạn chịu thế nào?" Trả lời 3–5 câu.', a: 'Redirect đi qua cache-aside Redis nên DB không bị chạm; một Redis node chịu cỡ 100k GET nhỏ mỗi giây nên 50k QPS vẫn trong ngưỡng. Để tránh dồn vào một shard khi dùng Redis cluster, API thêm local in-process cache TTL 1–5 giây cho key nóng. Click được publish bất đồng bộ vào Kafka nên analytics không ảnh hưởng độ trễ; nếu queue nghẽn thì chỉ trễ thống kê. API stateless nên LB thêm node là xong.', keys: ['cache', 'local cache', 'hot key', 'bất đồng bộ', 'stateless'] }
  ]
},
{ id: 'C2', type: 'case', topic: 'api', title: 'Case: Design a distributed rate limiter', time: '90 phút',
  goal: 'Chọn đúng thuật toán rate limit theo yêu cầu, viết được script Redis Lua atomic, giải thích đặt limiter ở đâu, đồng bộ nhiều node ra sao, và quyết định fail-open hay fail-closed khi Redis chết.',
  md: `
## Đề bài
> "Design a rate limiter for our public API. It should limit requests per client, work across all our API servers, and return a proper error when the limit is exceeded."

Dịch: thiết kế bộ giới hạn tần suất cho API công khai; giới hạn theo client; hoạt động đúng trên toàn bộ API server; trả lỗi chuẩn khi vượt ngưỡng. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Giới hạn theo gì: user id, API key, IP, hay tenant? → Đáp: theo API key là chính, có cả rule theo tenant và theo endpoint.
- Hỏi: Rule kiểu gì? → Đáp: ví dụ 100 request/phút cho mỗi key, 10 000/phút cho mỗi tenant, một số endpoint nặng riêng 10/phút.
- Hỏi: Chính xác tuyệt đối hay chấp nhận lệch vài phần trăm? → Đáp: lệch 1–5% chấp nhận được, nhưng không được chặn nhầm quá nhiều.
- Hỏi: Khi bị chặn trả gì? → Đáp: HTTP 429 kèm header cho client biết khi nào thử lại.
- Hỏi: Quy mô? → Đáp: 100k RPS tổng, 1M API key hoạt động, 20 API server.
- Hỏi: Rate limiter chết thì cho qua hay chặn hết? → Đáp: để bạn đề xuất.
- Hỏi: Có cần soft limit (cảnh báo, throttle) ngoài hard limit không? → Đáp: có, tenant trả tiền muốn burst.

Chốt lại:
**Functional**: giới hạn theo nhiều chiều (key, tenant, endpoint); rule cấu hình được không cần deploy; trả 429 với header chuẩn; cho phép burst có kiểm soát.
**Non-functional**: thêm dưới 2 ms độ trễ p99; quyết định thống nhất trên 20 node; sẵn sàng cao hơn API phía sau; bộ nhớ gọn cho 1M key.
**Ngoài phạm vi**: chống DDoS tầng mạng, WAF, billing theo usage.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Lượt kiểm tra | bằng số request API | 100k/s, mỗi request 1 round trip Redis |
| Round trip Redis trong DC | ~0,3–0,5 ms | cộng vào p99 ≈ 1 ms, đạt yêu cầu dưới 2 ms |
| Redis ops | 100k/s × 1 Lua call (2–4 lệnh bên trong) | 1 node Redis chịu ~100k ops/s → cần 2–3 shard để có headroom |
| Bộ nhớ sliding window counter | 1M key × 2 counter × ~80 B (key tên + giá trị + expire) | ≈ 160 MB |
| Bộ nhớ sliding window log | 1M key × 100 timestamp × 8 B | ≈ 800 MB, chưa kể overhead sorted set ×3 → vài GB |
| Rule config | vài nghìn rule × 200 B | dưới 1 MB, cache in-process được |

Rút ra: chi phí nằm ở **round trip Redis trên mọi request** và **bộ nhớ nếu lưu từng timestamp**. Thuật toán phải gọn về bộ nhớ và chỉ 1 round trip.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Client API key] -> GW[API gateway/middleware] : HTTPS
GW -> RL[Rate limiter lib trong gateway]
RL -> Redis[Redis cluster counters] : EVALSHA Lua 1 round trip
RL -> Rules[Rule cache in-process]
Admin[Admin UI] -> RulesDB[Rules store Postgres]
RulesDB -> Rules : pub/sub reload
GW -> API[API servers]
RL -> Metrics[Prometheus] : allowed, rejected
:::

**Luồng xử lý một request**: gateway lấy API key từ header → tra rule trong cache in-process (tenant, endpoint) → gọi 1 script Lua trên Redis với key = rl:{api_key}:{endpoint}, limit, window, now → script trả về (allowed, remaining, reset_at) → nếu allowed thì forward kèm header; nếu không thì 429 + Retry-After.

**Luồng cập nhật rule**: admin sửa rule → ghi Postgres → publish kênh Redis "rules_changed" → mọi gateway reload cache trong 1 giây. Không cần deploy lại.

API và header:
| Thành phần | Nội dung |
|---|---|
| Response header khi cho qua | X-RateLimit-Limit: 100; X-RateLimit-Remaining: 57; X-RateLimit-Reset: epoch giây |
| Response khi chặn | 429 Too Many Requests; Retry-After: 12; body JSON có mã lỗi và limit đang áp |
| Admin API | PUT /admin/rules/{id} body scope (key, tenant, endpoint), limit, window_s, burst |
| Internal | GET /internal/ratelimit/{key} xem trạng thái hiện tại để debug |

Mô hình dữ liệu trong Redis (sliding window counter):
| Key | Kiểu | Ý nghĩa |
|---|---|---|
| rl:{key}:{endpoint}:{window_id} | string integer, EXPIRE 2 × window | số request trong cửa sổ hiện tại |
| rl:{key}:{endpoint}:{window_id - 1} | string integer | cửa sổ trước, dùng để nội suy |
| rules:v | hash | version rule để cache in-process biết reload |

## 4. Đào sâu (15–18 phút)
### 4.1 Chọn thuật toán
| Thuật toán | Cách làm | Bộ nhớ mỗi key | Ưu | Nhược |
|---|---|---|---|---|
| Token bucket | bucket dung lượng B, nạp r token/s; request lấy 1 token | 2 số (tokens, last_refill) | Cho burst tới B, mượt, chuẩn công nghiệp | Hai tham số khó giải thích cho khách; cần tính refill theo thời gian |
| Leaky bucket | hàng đợi FIFO xả đều r/s | hàng đợi | Đầu ra cực đều | Request chờ trong queue, không hợp API đồng bộ; burst bị san phẳng |
| Fixed window | đếm theo phút lịch | 1 số | Đơn giản nhất | Đỉnh gấp đôi ở biên cửa sổ (100 cuối phút này + 100 đầu phút sau) |
| Sliding window log | lưu timestamp từng request trong sorted set | n timestamp | Chính xác tuyệt đối | Bộ nhớ tỉ lệ số request; 1M key × 100 → hàng GB |
| Sliding window counter | count_prev × phần trăm cửa sổ trước còn chồng + count_cur | 2 số | Gần đúng (lệch dưới vài %), gọn, không có đỉnh biên | Giả định phân bố đều trong cửa sổ trước |

Chọn **sliding window counter** cho rule "N request/phút" (đúng yêu cầu lệch vài % chấp nhận được) và **token bucket** cho rule có burst của tenant trả tiền. Nói rõ: fixed window bị người phỏng vấn bắt lỗi biên ngay.

### 4.2 Atomic trên Redis: vì sao cần Lua
Cách ngây thơ: GET → so sánh → INCR → EXPIRE là 3–4 round trip và có race: 2 node cùng đọc 99, cùng cho qua, thành 101. INCR rồi EXPIRE riêng còn có bug kinh điển: INCR xong process chết trước EXPIRE → key sống mãi.
Giải pháp: 1 script Lua chạy atomic trên Redis (Redis đơn luồng, script không bị xen ngang):
~~~lua
-- KEYS[1]=cur KEYS[2]=prev ARGV[1]=limit ARGV[2]=window_ms ARGV[3]=now_ms
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local elapsed = tonumber(ARGV[3]) % tonumber(ARGV[2])
local weight = 1 - elapsed / tonumber(ARGV[2])
local est = prev * weight + cur
if est >= tonumber(ARGV[1]) then return {0, 0} end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return {1, tonumber(ARGV[1]) - est - 1}
~~~
Hai key phải cùng hash slot trong Redis cluster → dùng hash tag: rl:{api_key}:cur và rl:{api_key}:prev (phần trong ngoặc nhọn quyết định slot). Dùng EVALSHA để không gửi script mỗi lần.

### 4.3 Đặt limiter ở đâu và đồng bộ nhiều node
| Phương án | Ưu | Nhược |
|---|---|---|
| Trong từng API server, counter local | 0 round trip | 20 node = 20 counter riêng, limit thực tế gấp 20 lần; LB round-robin làm sai hoàn toàn |
| Counter local + đồng bộ định kỳ (gossip hoặc ghi Redis mỗi 100 ms) | Nhanh, chịu được Redis chập chờn | Lệch trong cửa sổ đồng bộ; phức tạp |
| Counter tập trung Redis, gọi từ gateway (chọn) | Một sự thật duy nhất, lệch gần 0, code đơn giản | Thêm 1 round trip; Redis thành dependency nóng |
| Sticky routing theo API key về cùng node | Counter local vẫn đúng | Phân tải lệch, node chết mất counter |

Chọn tập trung tại **gateway** (một chỗ duy nhất, API phía sau không cần biết) với Redis cluster; phương án local + sync để dành khi p99 không cho phép round trip.

### 4.4 Hard limit, soft limit, và khi Redis chết
- **Hard limit**: vượt là 429. **Soft limit**: vượt ngưỡng mềm (ví dụ 80%) thì vẫn cho qua nhưng gắn header cảnh báo, bắn metric, hoặc hạ ưu tiên; tenant trả tiền có burst = token bucket với B lớn hơn r × window.
- **Fail-open vs fail-closed**: Redis timeout hay lỗi → cho qua (fail-open) để không biến limiter thành nguyên nhân sập dịch vụ, nhưng bật counter local tạm thời với limit chặt hơn và báo động. Fail-closed chỉ dùng cho endpoint nhạy cảm (đăng nhập, OTP) nơi để lọt nguy hiểm hơn chặn nhầm. Nói rõ bạn chọn theo từng endpoint, không chọn một kiểu cho cả hệ.
- Timeout gọi Redis đặt rất ngắn (5–10 ms) để fail-open nhanh, không để limiter kéo p99.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Hai request cùng lúc ở 2 node, cùng thấy còn 1 slot?" → Lua chạy atomic trên Redis, hai lệnh nối tiếp nhau, lệnh thứ hai thấy counter đã tăng và bị chặn.
2. "Clock lệch giữa các gateway thì sao?" → Dùng thời gian của Redis (lệnh TIME trong script) thay cho now của client để mọi node cùng một đồng hồ.
3. "Rate limit theo IP có vấn đề gì?" → NAT và mobile carrier gom hàng nghìn user sau một IP; chỉ dùng IP cho lớp chống lạm dụng thô, không dùng cho hạn mức sản phẩm.
4. "Client nên làm gì khi nhận 429?" → Đọc Retry-After, backoff theo cấp số nhân có jitter; SDK của bạn nên làm sẵn.
5. "Redis cluster resharding thì counter mất?" → Mất vài giây counter là chấp nhận được với rate limit; không cần persistence, tắt AOF cho nhanh.
6. "Giới hạn theo tenant và theo key cùng lúc?" → Gọi 2 script hoặc 1 script nhận nhiều key cùng hash tag; chặn nếu bất kỳ chiều nào vượt; trả header của chiều chặt nhất.
7. "Làm sao test đúng hành vi biên cửa sổ?" → Test với đồng hồ giả: bắn 100 request ở giây 59 rồi 100 request ở giây 61, fixed window cho qua 200, sliding phải chặn.
8. "Có nên rate limit cả outbound (gọi API bên thứ ba) không?" → Có, token bucket phía client để không bị provider chặn; đây là cùng thuật toán nhưng đặt ở phía gọi ra.

### Sai lầm hay gặp
- Nói "dùng Redis INCR" mà không nhắc EXPIRE và race giữa INCR và EXPIRE.
- Chọn sliding window log vì "chính xác" mà không tính bộ nhớ.
- Bỏ qua câu hỏi Redis chết, hoặc trả lời một kiểu cho mọi endpoint.
- Quên header trả về client; limiter tốt phải cho client biết khi nào thử lại.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Thuật toán | Chỉ biết fixed window | So sánh 4–5 thuật toán, chọn theo yêu cầu độ chính xác và bộ nhớ |
| Tính đúng đắn phân tán | Counter local mỗi node | Redis tập trung + Lua atomic + hash tag, nói được race cụ thể |
| Vận hành | Không nói Redis chết | Fail-open theo endpoint, timeout ngắn, metric, rule reload không deploy |
| Trải nghiệm client | Chỉ trả 429 | Header Limit, Remaining, Reset, Retry-After; soft limit |
| Chi phí | Không ước lượng | 100k ops/s, 160 MB cho 1M key, p99 cộng 1 ms |

### Nói thế nào trong phỏng vấn (EN)
- "Fixed window allows twice the limit at the boundary, so I would use a sliding window counter which is accurate within a few percent." — Fixed window cho gấp đôi ở biên, dùng sliding window counter.
- "The check must be atomic, so I would run it as a single Lua script on Redis instead of GET then INCR." — Phải atomic nên gói trong 1 script Lua.
- "I would fail open on Redis errors for most endpoints, but fail closed for login and OTP." — Fail-open đa số, fail-closed cho endpoint nhạy cảm.
- "The limiter lives in the gateway so the backend services never need to know about it." — Limiter nằm ở gateway, backend không cần biết.
- "Every response carries the limit, remaining and reset headers so well-behaved clients can back off." — Header cho client tự lùi.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Nhu cầu rõ nhất không phải inbound mà là **outbound**: ClearlyDefined, NVD (khoảng 50 request mỗi 30 giây khi có API key), GHSA, OSV đều có hạn mức. Worker và Lambda của bạn gọi theo batch mà không có token bucket chung → khi nhiều Lambda chạy song song, provider trả 429 hoặc timeout, FetchBatch nuốt lỗi và hàng nghìn dòng thành enrichment_failed vĩnh viễn (sự cố coordinate version-range làm hỏng cả batch).
- Việc làm được tuần này: viết package Go ratelimit dùng Redis Lua token bucket theo provider (key rl:cd, rl:nvd), Lambda lấy token trước mỗi batch; Redis đã có sẵn trong stack. Lưu ý sự cố Lambda mất REDIS_HOST → limiter phải fail-open kèm metric, không được làm enrichment đứng hẳn.
- Inbound: giới hạn upload SBOM theo tenant (ví dụ 20 file/giờ, kích thước 50 MB) để chặn kịch bản 5 file stress test 200k component làm pending backlog 696k dòng. Đặt ở middleware của apiserver, rule theo tenant lưu Postgres và cache in-process.
- Header 429 với Retry-After giúp FE Next.js hiển thị "thử lại sau N giây" thay vì lỗi chung chung.
- Policy evaluation liên tục 238 policy ghim DB 4 vCPU là bài toán rate limit nội bộ: giới hạn số eval đồng thời theo tenant bằng semaphore + token bucket trên Redis, thay vì để gocron bắn hết cùng lúc.
- ADR nên viết: "Mọi lời gọi provider ngoài đi qua một limiter dùng chung; fail-open có cảnh báo; limit lấy từ config, không hard-code".
`,
  quiz: [
    { t: 'mc', q: 'Nhược điểm nổi bật của fixed window counter là gì?', o: ['Tốn bộ nhớ tỉ lệ số request', 'Cho phép tới gấp đôi limit tại biên hai cửa sổ liên tiếp', 'Không chạy được trên Redis', 'Không hỗ trợ per-tenant'], a: 1, why: '100 request cuối phút này và 100 request đầu phút sau đều hợp lệ, tức 200 trong 2 giây.' },
    { t: 'mc', q: 'Vì sao nên gói kiểm tra rate limit vào một script Lua trên Redis?', o: ['Để script chạy atomic, tránh race giữa GET và INCR và bug INCR mà không EXPIRE', 'Lua chạy nhanh hơn lệnh Redis thường', 'Để giảm bộ nhớ', 'Để không cần hash tag'], a: 0, why: 'Redis đơn luồng và script không bị xen ngang, nên đọc, so sánh, tăng, đặt TTL là một thao tác nguyên tử.' },
    { t: 'mc', q: 'Sliding window log (lưu từng timestamp) không phù hợp cho 1M API key vì?', o: ['Không chính xác', 'Không hỗ trợ burst', 'Chỉ chạy được một node', 'Bộ nhớ tỉ lệ số request mỗi key, lên hàng GB'], a: 3, why: 'Mỗi request là một phần tử trong sorted set; 1M key × 100 timestamp đã là hàng GB kể cả overhead.' },
    { t: 'mc', q: 'Khi Redis timeout, cách xử lý hợp lý nhất cho đa số endpoint công khai là gì?', o: ['Chặn toàn bộ request cho an toàn', 'Chờ Redis hồi phục rồi mới trả lời', 'Fail-open có cảnh báo và counter local tạm thời, riêng endpoint nhạy cảm thì fail-closed', 'Tắt rate limit vĩnh viễn'], a: 2, why: 'Limiter không được trở thành nguyên nhân sập dịch vụ; chỉ endpoint như login, OTP mới đáng chặn nhầm hơn để lọt.' },
    { t: 'mc', q: 'Trong Redis cluster, để script Lua thao tác hai key cur và prev của cùng API key, cần gì?', o: ['Hash tag chung trong tên key để cả hai nằm cùng hash slot', 'Dùng hai kết nối khác nhau', 'Tắt cluster mode', 'Dùng MULTI thay cho Lua'], a: 0, why: 'Script chỉ chạy được trên một node; phần trong ngoặc nhọn của tên key quyết định slot.' },
    { t: 'fill', q: 'Điền: thuật toán rate limit cho phép burst tới dung lượng B và nạp lại r token mỗi giây gọi là ___ bucket.', a: ['token', 'token bucket'], why: 'Token bucket cho burst có kiểm soát; leaky bucket thì xả đều và không cho burst.' },
    { t: 'fill', q: 'Điền: khi bị chặn, server trả mã 429 kèm header ___ để client biết sau bao nhiêu giây thử lại.', a: ['retry-after', 'retry after'], why: 'Retry-After là header chuẩn HTTP; client nên backoff có jitter theo giá trị này.' },
    { t: 'open', q: 'Giải thích vì sao đặt counter local trong từng API server là sai với yêu cầu limit toàn hệ, và bạn khắc phục ra sao. Trả lời 3–5 câu.', a: 'Load balancer chia request của một client ra 20 node, mỗi node đếm riêng nên limit thực tế thành 20 lần mức khai báo, và kết quả còn thay đổi theo cách phân tải. Khắc phục chuẩn là counter tập trung trên Redis, kiểm tra bằng Lua atomic để tránh race giữa các node, chấp nhận thêm khoảng 0,5 ms round trip. Nếu p99 không cho phép, dùng counter local kết hợp đồng bộ định kỳ về Redis, chấp nhận lệch nhỏ trong cửa sổ đồng bộ. Khi Redis lỗi thì fail-open và bật counter local tạm thời.', keys: ['load balancer', 'Redis', 'atomic', 'round trip', 'fail-open'] }
  ]
},
{ id: 'C3', type: 'case', topic: 'storage', title: 'Case: Design a key-value store (Dynamo-style)', time: '120 phút',
  goal: 'Thiết kế được KV store phân tán kiểu Dynamo: consistent hashing với virtual node, replication N và quorum W/R, vector clock, hinted handoff, Merkle tree, gossip, và giải thích write/read path trên LSM tree.',
  md: `
## Đề bài
> "Design a distributed key-value store. It should support put(key, value) and get(key), scale horizontally to hundreds of nodes, stay available during node failures, and let us tune consistency."

Dịch: thiết kế kho key-value phân tán với put/get; scale ngang tới hàng trăm node; vẫn sẵn sàng khi node hỏng; cho phép chỉnh mức consistency. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Kích thước key/value? → Đáp: key dưới 1 KB, value dưới 10 KB, không cần blob lớn.
- Hỏi: Tổng dữ liệu và QPS? → Đáp: 100 TB, 300k đọc/s, 100k ghi/s.
- Hỏi: Ưu tiên availability hay consistency khi partition? → Đáp: availability, nhưng cho phép client chọn strong read khi cần.
- Hỏi: Có range query hay chỉ theo key? → Đáp: chỉ theo key.
- Hỏi: Một DC hay nhiều? → Đáp: một DC trước, thiết kế để mở rộng.
- Hỏi: Có cần transaction nhiều key? → Đáp: không.

Chốt lại:
**Functional**: put, get, delete theo key; TTL tuỳ chọn; client chọn mức consistency mỗi lần gọi.
**Non-functional**: p99 get dưới 10 ms; sẵn sàng 99,99%; mất 1–2 node không mất dữ liệu, không gián đoạn; thêm node không phải di chuyển quá 1/N dữ liệu; tunable consistency.
**Ngoài phạm vi**: query thứ cấp, transaction, SQL.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Dữ liệu gốc | 100 TB, trung bình 10 KB/value → 10 tỷ key | 100 TB |
| Dữ liệu sau replication N = 3 | 100 TB × 3 | 300 TB |
| Số node | mỗi node 4 TB SSD, dùng 75% → 3 TB hữu ích | 300 / 3 = 100 node |
| Đọc mỗi node | 300k / 100 | 3k QPS, mỗi lần đọc chạm 2–3 replica → ~9k ops/node |
| Ghi mỗi node | 100k × 3 replica / 100 | 3k ghi/s, LSM ghi tuần tự nên dễ |
| Băng thông ghi | 100k × 10 KB × 3 | 3 GB/s toàn cụm, 30 MB/s mỗi node |
| Metadata ring | 100 node × 150 vnode × ~50 B | dưới 1 MB, mỗi node giữ bản sao đầy đủ |

Rút ra: không có node nào quá tải nếu phân phối đều; **vấn đề thật là phân phối đều, tự phục hồi khi node hỏng, và conflict khi hai bản ghi cùng key đến các replica khác nhau**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Client lib] -> Coord[Coordinator = node bất kỳ] : put/get
Coord -> Ring[Consistent hash ring vnode] : tìm N replica
Coord -> R1[Replica 1] : ghi song song
Coord -> R2[Replica 2]
Coord -> R3[Replica 3]
R1 -> LSM1[Commit log + memtable + SSTable]
Coord -> Hint[Hinted handoff store] : khi replica chết
R1 -- R2 : gossip membership
R2 -- R3 : Merkle anti-entropy
:::

**Write path**: client gửi put tới node bất kỳ (coordinator) → coordinator hash(key) lên ring, tìm N = 3 node kế tiếp theo chiều kim đồng hồ (preference list) → gửi song song → chờ W node trả lời OK → trả về client. Trong mỗi node: append commit log → ghi memtable → khi memtable đầy flush ra SSTable → compaction nền.
**Read path**: coordinator gửi get tới N replica → chờ R phản hồi → nếu các bản khác version thì hoà giải (vector clock) hoặc trả cả hai cho client → read repair ghi lại bản mới nhất cho replica cũ. Trong node: memtable → Bloom filter của từng SSTable → đọc SSTable có khả năng chứa.

API:
| Method | Mô tả |
|---|---|
| put(key, value, context, consistency) | context chứa version nhận từ get trước; consistency = ONE, QUORUM, ALL |
| get(key, consistency) | trả value và context; có thể trả nhiều version nếu conflict |
| delete(key) | ghi tombstone, dọn sau grace period |
| admin: join, leave, status | thêm/bớt node, xem ring và health |

Mô hình dữ liệu trong node:
| Thành phần | Nội dung |
|---|---|
| Commit log | append-only, fsync theo nhóm, phục hồi memtable khi restart |
| Memtable | skip list hoặc red-black tree, 64–256 MB |
| SSTable | file sorted immutable + index + Bloom filter |
| Metadata | ring, vnode, membership, hint queue |

## 4. Đào sâu (15–18 phút)
### 4.1 Phân vùng dữ liệu
| Phương án | Ưu | Nhược |
|---|---|---|
| hash(key) mod N | Đơn giản | Thêm 1 node → gần như toàn bộ key đổi chỗ |
| Range partition | Range scan tốt | Hot range, cần rebalance thủ công |
| Consistent hashing, 1 điểm mỗi node | Thêm node chỉ di chuyển ~1/N key | Phân bố không đều, node mạnh yếu như nhau |
| Consistent hashing + virtual node (chọn) | Đều hơn (độ lệch chuẩn ~5–10% với 100–200 vnode), node mạnh gán nhiều vnode, mất node thì tải chia đều cho nhiều node | Bảng ring lớn hơn, preference list phải bỏ qua vnode trùng node vật lý |

Chọn consistent hashing với 100–200 vnode mỗi node vật lý. Khi tìm N replica, đi theo ring nhưng bỏ qua vnode thuộc cùng node vật lý (và cùng rack nếu có) để 3 bản sao thật sự khác máy.

### 4.2 Replication và quorum
Quy tắc: N bản sao, ghi chờ W, đọc chờ R. Nếu **W + R > N** thì tập đọc và tập ghi luôn giao nhau nên đọc thấy bản ghi mới nhất (strong-ish). Nếu W + R ≤ N thì đọc có thể cũ nhưng nhanh và sẵn sàng hơn.
| Cấu hình (N = 3) | Đặc tính | Dùng khi |
|---|---|---|
| W = 1, R = 1 | Nhanh nhất, có thể đọc cũ | Cache, counter không quan trọng |
| W = 2, R = 2 | Đọc thấy ghi mới nhất, chịu 1 node chết | Mặc định |
| W = 3, R = 1 | Ghi chậm, đọc nhanh và nhất quán | Đọc nhiều hơn ghi rất nhiều |
| W = 1, R = 3 | Ghi cực nhanh, đọc chậm | Ghi nhiều, đọc hiếm |
Nói rõ: quorum không phải linearizability tuyệt đối (sloppy quorum, clock, retry), nhưng đủ cho đa số nhu cầu.

### 4.3 Conflict và versioning
Hai client ghi cùng key vào hai replica khác nhau trong lúc partition → hai version. Phương án:
| Phương án | Ưu | Nhược |
|---|---|---|
| Last write wins theo timestamp | Đơn giản, Cassandra dùng | Mất dữ liệu âm thầm khi clock lệch |
| Vector clock [(node, counter)] | Phát hiện được concurrent write, không mất dữ liệu | Client phải hoà giải; vector dài → cắt bớt theo ngưỡng |
| CRDT | Hoà giải tự động | Chỉ cho kiểu dữ liệu nhất định (counter, set) |
Chọn vector clock cho đúng tinh thần Dynamo: get trả về context, put kèm context, server so sánh; nếu hai vector không so sánh được thì giữ cả hai (sibling) và trả cho client hoà giải (ví dụ giỏ hàng: union).

### 4.4 Khi node hỏng
- **Phát hiện**: gossip protocol, mỗi giây mỗi node trao đổi membership với vài node ngẫu nhiên; node không heartbeat quá ngưỡng bị đánh dấu nghi ngờ; không có node trung tâm.
- **Hỏng tạm (sloppy quorum + hinted handoff)**: replica chết → coordinator ghi vào node khoẻ kế tiếp trên ring kèm "hint" rằng dữ liệu thuộc về node X; node X sống lại → chuyển trả. Giữ được W mà không từ chối ghi.
- **Hỏng lâu (anti-entropy bằng Merkle tree)**: mỗi node xây Merkle tree cho mỗi range key; so sánh root hash với replica khác, chỉ đi xuống nhánh khác nhau → đồng bộ đúng phần lệch, băng thông tối thiểu.
- **Mất cả DC**: replica rải nhiều DC qua preference list có nhận biết DC; ngoài phạm vi đề nhưng nên nhắc một câu.

### 4.5 Storage engine: LSM vs B-tree
Ghi 3k/s mỗi node và value nhỏ → **LSM tree**: ghi là append tuần tự (nhanh trên cả HDD và SSD), đọc trả giá bằng kiểm tra nhiều SSTable, giảm bằng Bloom filter (false positive ~1%) và compaction (leveled để đọc nhanh, size-tiered để ghi nhanh). B-tree phù hợp đọc nhiều và range scan nhưng ghi ngẫu nhiên gây write amplification trên trang. Tombstone cho delete phải giữ qua grace period để không "hồi sinh" dữ liệu từ replica chưa nhận delete.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Tại sao không dùng Postgres shard?" → Có thể, nhưng đề yêu cầu tunable consistency, sẵn sàng khi partition và không cần SQL; Dynamo-style đơn giản hơn để đạt điều đó.
2. "Chọn N, W, R thế nào?" → N = 3 là chuẩn; W = R = 2 mặc định; cho client ghi đè theo request.
3. "Hot key thì sao?" → Client cache, hoặc tách key thành key#1..key#k rồi đọc ngẫu nhiên; viết ra rằng consistent hashing không giải quyết hot key, chỉ giải quyết hot node.
4. "Vector clock phình to?" → Cắt entry cũ nhất khi vượt 10 entry (Dynamo làm vậy), chấp nhận hoà giải thiếu chính xác hiếm hoi.
5. "Thêm 10 node một lúc?" → Mỗi node mới nhận vnode từ nhiều node cũ, stream song song, giới hạn băng thông để không ảnh hưởng traffic; cập nhật ring qua gossip.
6. "Đọc thấy dữ liệu cũ dù W + R > N?" → Sloppy quorum ghi vào node tạm, hoặc retry sau timeout tạo ra bản sao chậm; read repair và anti-entropy sẽ hội tụ.
7. "Delete thế nào cho đúng?" → Tombstone, không xoá vật lý ngay; nếu xoá sớm, replica chết lúc đó sống lại sẽ làm dữ liệu quay về.
8. "Client lib thông minh hay dumb?" → Lib biết ring thì gửi thẳng tới replica, bớt một hop; đổi lại phải cập nhật ring ở client.

### Sai lầm hay gặp
- Vẽ ring nhưng không nói virtual node và tại sao cần.
- Nói "quorum nên strongly consistent" mà không nêu điều kiện W + R > N.
- Dùng timestamp để giải conflict mà không nhắc clock lệch.
- Quên tombstone khi nói về delete.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Phân vùng | hash mod N | Consistent hashing, vnode, bỏ qua cùng node vật lý |
| Replication | "Sao ra 3 bản" | N, W, R, điều kiện giao nhau, bảng cấu hình theo use case |
| Xử lý lỗi | "Có failover" | Gossip, hinted handoff, Merkle, read repair |
| Conflict | LWW không nghĩ thêm | Vector clock, sibling, client hoà giải |
| Storage engine | Không nói | LSM, Bloom filter, compaction, tombstone |

### Nói thế nào trong phỏng vấn (EN)
- "I would partition with consistent hashing and virtual nodes so adding a node moves only about one over N of the keys." — Consistent hashing + vnode, thêm node chỉ dời 1/N key.
- "With N equals three, W plus R greater than three guarantees the read set overlaps the latest write." — W + R > N thì đọc chồng lên ghi mới nhất.
- "For temporary failures I would use sloppy quorum with hinted handoff; for long failures, Merkle tree anti-entropy." — Hỏng tạm dùng hinted handoff, hỏng lâu dùng Merkle.
- "I prefer vector clocks over last-write-wins because they surface conflicts instead of silently dropping data." — Vector clock lộ conflict thay vì mất dữ liệu âm thầm.
- "Each node stores data in an LSM tree: sequential writes, Bloom filters to avoid touching every SSTable." — LSM ghi tuần tự, Bloom filter giảm đọc.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Redis cluster của bạn phân vùng theo 16 384 hash slot, cùng tư tưởng consistent hashing; khi thêm node, slot được chuyển chứ không hash lại toàn bộ. Nếu dùng Lua đa key cho rate limit hay cache enrichment, cần hash tag để key cùng slot (nối C2).
- Postgres tenant của bạn chia theo tenant_id là "range partition theo tenant": tenant lớn (project 90k component, 490k link vulnerability) chính là hot range; bài học hot key: không cách phân vùng nào cứu được, phải giới hạn truy vấn (phân trang, không Preload toàn bộ).
- Sự cố license cross-tenant kiểu "first-writer-wins" trên t_components là bài toán conflict resolution: hai tenant ghi cùng key (purl) với giá trị khác nhau, bản ghi đầu thắng và leak sang tenant khác. Fix overlay per-tenant chính là "giữ sibling theo tenant" thay vì LWW.
- FDW nối DB vulnerability chung với DB tenant đóng vai trò replica chỉ đọc không có anti-entropy: schema remote đóng băng sau migration gây 500 "column does not exist". Bài này cho ngôn ngữ để giải thích: không có cơ chế đồng bộ metadata, phải refresh thủ công (IMPORT FOREIGN SCHEMA) sau mỗi migration.
- Việc tuần này: viết checklist "thêm cột ở DB vulnerability → refresh FDW ở từng tenant DB" thành bước bắt buộc trong runbook release; đo độ lệch dữ liệu giữa bản gốc và bản qua FDW bằng count theo ngày (một dạng Merkle thủ công).
- Khi phỏng vấn, kể câu chuyện 90 giây về leak license cross-tenant để minh hoạ vì sao LWW trên dữ liệu dùng chung là nguy hiểm.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao dùng virtual node trong consistent hashing?', o: ['Để giảm số node vật lý cần mua', 'Để tăng tốc hash', 'Để không cần replication', 'Để phân bố key đều hơn và khi một node chết tải chia cho nhiều node thay vì một node kế tiếp'], a: 3, why: 'Nhiều điểm trên ring cho mỗi node làm phân bố đều hơn và tải của node hỏng rải ra nhiều node.' },
    { t: 'mc', q: 'Với N = 3, cấu hình nào đảm bảo đọc thấy bản ghi mới nhất?', o: ['W = 1, R = 1', 'W = 2, R = 1', 'W = 2, R = 2', 'W = 1, R = 2'], a: 2, why: 'Cần W + R > N; 2 + 2 = 4 > 3 nên tập đọc và tập ghi luôn giao nhau.' },
    { t: 'mc', q: 'Hinted handoff giải quyết tình huống nào?', o: ['Replica tạm thời không liên lạc được trong lúc ghi', 'Hai client ghi cùng key cùng lúc', 'Dữ liệu lệch lâu ngày giữa hai replica', 'Memtable đầy'], a: 0, why: 'Coordinator ghi tạm sang node khác kèm hint, node đích sống lại thì nhận lại dữ liệu.' },
    { t: 'mc', q: 'Nhược điểm chính của last-write-wins theo timestamp là gì?', o: ['Tốn bộ nhớ', 'Mất dữ liệu âm thầm khi đồng hồ các node lệch nhau', 'Không chạy được khi partition', 'Chậm hơn vector clock'], a: 1, why: 'Timestamp lớn hơn thắng kể cả khi nó thực ra đến sau; không ai biết dữ liệu đã bị ghi đè.' },
    { t: 'mc', q: 'Trong LSM tree, Bloom filter dùng để làm gì?', o: ['Nén SSTable', 'Sắp xếp memtable', 'Tránh đọc những SSTable chắc chắn không chứa key', 'Thay commit log'], a: 2, why: 'Bloom filter trả lời chắc chắn "không có" nên bỏ qua được phần lớn SSTable khi đọc.' },
    { t: 'fill', q: 'Điền: cơ chế so sánh hash theo cây để chỉ đồng bộ đúng phần dữ liệu lệch giữa hai replica gọi là ___ tree.', a: ['merkle', 'merkle tree'], why: 'So root hash, chỉ đi xuống nhánh khác nhau, băng thông tối thiểu.' },
    { t: 'fill', q: 'Điền: khi delete trong hệ Dynamo-style, node ghi một ___ thay vì xoá vật lý ngay để replica chưa nhận delete không làm dữ liệu quay lại.', a: ['tombstone'], why: 'Tombstone giữ qua grace period rồi mới dọn ở compaction.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Hai người dùng cùng sửa một giỏ hàng khi mạng bị chia cắt. Hệ của bạn xử lý thế nào?" Trả lời 3–5 câu.', a: 'Hai bản ghi đến hai replica khác nhau và mang vector clock không so sánh được, nên server không ghi đè mà giữ cả hai sibling. Khi mạng lành, get trả về cả hai version kèm context; client hoà giải theo nghiệp vụ, với giỏ hàng là union các item, rồi put lại với context gộp. Read repair và anti-entropy đưa bản hoà giải tới mọi replica. Tôi tránh last-write-wins vì nó sẽ lặng lẽ mất item của một trong hai người.', keys: ['vector clock', 'sibling', 'hoà giải', 'read repair', 'last-write-wins'] }
  ]
},
{ id: 'C4', type: 'case', topic: 'data', title: 'Case: Design a unique ID generator in distributed systems', time: '75 phút',
  goal: 'So sánh được multi-master increment, UUID, ticket server và Snowflake; trình bày bit layout Snowflake, xử lý clock backwards, và giải thích vì sao id sắp xếp theo thời gian tốt cho index B-tree.',
  md: `
## Đề bài
> "Design a service that generates unique IDs for our distributed system. IDs must be unique, roughly sortable by time, fit in 64 bits, and we need to generate at least ten thousand per second."

Dịch: thiết kế bộ sinh ID duy nhất cho hệ phân tán; ID duy nhất, sắp xếp được gần đúng theo thời gian, nằm trong 64 bit, ít nhất 10 000 ID mỗi giây. Thời gian 45 phút (thực tế đề này thường gói trong 25–30 phút).

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: ID là số hay chuỗi? → Đáp: số nguyên 64 bit để lưu gọn trong DB.
- Hỏi: Chỉ cần duy nhất hay cần tăng dần? → Đáp: tăng dần theo thời gian ở mức toàn hệ là tốt, không cần liên tục (có khoảng trống được).
- Hỏi: Có được lộ thông tin (thời điểm tạo, số lượng) không? → Đáp: lộ thời điểm được, không muốn lộ tổng số bản ghi.
- Hỏi: Bao nhiêu node sinh ID, có cần sinh offline không? → Đáp: vài trăm instance, mỗi instance tự sinh không gọi mạng là lý tưởng.
- Hỏi: Thời gian sống của hệ? → Đáp: ít nhất 50 năm.
- Hỏi: Đồng hồ máy có thể lệch? → Đáp: có NTP nhưng vẫn có thể nhảy lùi.

Chốt lại:
**Functional**: sinh ID 64 bit duy nhất toàn cục; sắp xếp gần đúng theo thời gian tạo; không cần liên tục.
**Non-functional**: 10k ID/s mỗi node tối thiểu (thực tế cần dư hàng trăm lần); độ trễ micro giây; không có điểm phụ thuộc trung tâm trên đường nóng; sống 50+ năm; chịu clock lệch.
**Ngoài phạm vi**: ID dạng chuỗi thân thiện (slug), ID bảo mật không đoán được (dùng token ngẫu nhiên riêng).

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Nhu cầu | 10k/s mỗi node × 200 node | 2M ID/s toàn hệ |
| 41 bit timestamp ms | 2^41 ms ≈ 2,2 × 10^12 ms / (3,15 × 10^10 ms/năm) | ≈ 69 năm, đạt yêu cầu 50 năm |
| 12 bit sequence | 2^12 = 4 096 ID mỗi ms mỗi node | ≈ 4M ID/s mỗi node, dư 400 lần |
| 10 bit node id | 2^10 | 1 024 node, dư cho 200 |
| 1 bit dấu | giữ 0 để ID luôn dương | tổng 1 + 41 + 10 + 12 = 64 bit |
| So với UUID 128 bit | 2 × 8 B mỗi khoá, mỗi index | tiết kiệm một nửa dung lượng khoá và index |

Rút ra: 64 bit chia được đủ cho cả ba chiều (thời gian, node, sequence) với dư lớn; **điểm khó không phải số bit mà là đồng hồ và cấp node id**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
App[App instance Go] -> Gen[ID generator lib in-process] : NextID()
Gen -> Clock[System clock ms]
Gen -> Seq[Sequence 12 bit per ms]
Gen -> NodeID[Node id 10 bit]
Reg[Coordinator ZooKeeper/etcd hoặc DB] -> NodeID : cấp lúc khởi động, lease
App -> DB[Postgres bảng dùng ID làm PK]
:::

**Luồng sinh ID** (trong process, không gọi mạng): đọc thời gian ms → nếu cùng ms với lần trước thì sequence + 1 (tràn 4 096 thì spin chờ sang ms kế) → nếu ms mới thì sequence = 0 → ghép bit: (ts - epoch_tuỳ_chỉnh) << 22, node_id << 12, sequence. Dùng epoch tuỳ chỉnh (ví dụ 2024-01-01) để kéo dài tuổi thọ 69 năm tính từ đó.
**Luồng cấp node id**: lúc instance khởi động, xin một node id chưa dùng từ etcd/ZooKeeper (ephemeral node) hoặc bảng DB với lease; instance giữ lease bằng heartbeat; mất lease thì ngừng sinh ID. Trong Kubernetes có thể lấy từ StatefulSet ordinal.

API và cấu trúc:
| Thành phần | Nội dung |
|---|---|
| NextID() int64 | thread-safe bằng mutex hoặc atomic CAS; không I/O |
| Decode(id) → (time, node, seq) | tiện debug, đọc thời điểm tạo từ ID |
| Bit layout | 1 bit dấu, 41 bit ms từ epoch tuỳ chỉnh, 10 bit node (có thể tách 5 DC + 5 máy), 12 bit sequence |
| Node registry | etcd key /idgen/nodes/{n} ephemeral, TTL 30 s |

## 4. Đào sâu (15–18 phút)
### 4.1 So sánh các phương án
| Phương án | Cách làm | Ưu | Nhược |
|---|---|---|---|
| Multi-master auto increment | k DB, DB thứ i sinh i, i+k, i+2k | Dễ, dùng sẵn sequence DB | Không sắp xếp theo thời gian giữa các DB; thêm bớt DB phải đổi k; không scale ngang vô hạn |
| UUID v4 | 128 bit ngẫu nhiên | Không cần phối hợp, sinh ở đâu cũng được | 128 bit; hoàn toàn ngẫu nhiên → B-tree index bị chèn khắp nơi, page split, cache miss, WAL phình |
| UUID v7 hoặc ULID | 48 bit ms + random | Sắp xếp theo thời gian, không cần node id | Vẫn 128 bit; chuẩn mới hơn, không phải lib nào cũng có |
| Ticket server (Flickr) | một DB nhỏ chỉ làm REPLACE INTO để lấy auto increment | Đơn giản, ID liên tục | SPOF, mỗi ID một round trip; 2 ticket server chẵn lẻ để HA nhưng vẫn là điểm nghẽn |
| Snowflake (chọn) | 41 ts + 10 node + 12 seq | 64 bit, sắp xếp theo thời gian, sinh local không mạng, 4M/s/node | Phụ thuộc đồng hồ; phải cấp node id duy nhất |

Chọn Snowflake vì khớp cả 4 yêu cầu (64 bit, sortable, không trung tâm, throughput). Nói rõ nếu đề cho phép 128 bit thì UUID v7 là lựa chọn ít việc hơn.

### 4.2 Vì sao ID theo thời gian tốt cho DB
B-tree index chèn key tăng dần vào trang bên phải cùng → trang nóng duy nhất, ít page split, WAL ít. UUID v4 chèn ngẫu nhiên → mọi trang đều có thể bị sửa, với bảng 100M dòng index UUID có thể lớn gấp đôi và cache hit tệ. Ngoài ra ID theo thời gian cho phép range scan theo khoảng thời gian ngay trên PK, và dùng làm cursor cho pagination keyset thay cho OFFSET.

### 4.3 Clock backwards
Đồng hồ nhảy lùi (NTP chỉnh, VM migrate, leap second) → cùng (ts, node, seq) có thể sinh lại ID cũ → trùng.
| Phương án | Ưu | Nhược |
|---|---|---|
| Từ chối sinh ID cho tới khi thời gian vượt last_ts | An toàn, đơn giản | Lệch lớn thì dịch vụ đứng |
| Chờ nếu lệch nhỏ (dưới 5–10 ms), lỗi nếu lệch lớn (chọn) | Thực dụng, Twitter làm vậy | Cần cảnh báo và cơ chế đổi node id khi lệch lớn |
| Dùng last_ts làm thời gian logic (không bao giờ lùi) và tiếp tục tăng sequence | Không bao giờ đứng | Timestamp trong ID lệch khỏi thời gian thật; sequence có thể tràn |
| Dự phòng vài bit "clock generation" tăng khi phát hiện lùi | Tiếp tục chạy an toàn | Tốn bit, layout phức tạp hơn |
Thực hành: lưu last_ts trong RAM, nếu now < last_ts: lệch dưới 10 ms thì sleep, lớn hơn thì trả lỗi và bắn alert; không bao giờ dùng wall clock đã lùi.

### 4.4 Cấp node id và an toàn khi restart
- Node id cấp bằng etcd ephemeral + lease: instance chết thì id được giải phóng sau TTL; instance mới không nhận id vừa giải phóng trong vòng vài giây để chắc chắn không trùng ms cuối cùng của instance cũ (hoặc lưu last_ts của node vào etcd và chờ qua mốc đó).
- Nếu không có coordinator: dùng địa chỉ MAC hash hoặc IP cuối, nhưng phải chứng minh không trùng trong cụm; ở container IP thay đổi nên không khuyến khích.
- Tách 10 bit thành 5 bit DC + 5 bit máy khi có nhiều DC để mỗi DC tự cấp.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Vì sao không dùng UUID cho xong?" → UUID v4 128 bit và ngẫu nhiên: index phình, chèn ngẫu nhiên, không sắp xếp được; UUID v7 giải quyết sắp xếp nhưng vẫn 128 bit.
2. "ID có lộ thông tin gì?" → Lộ thời điểm tạo và node; không lộ tổng số bản ghi như auto increment. Nếu ID ra ngoài public, có thể encode hoặc dùng token riêng.
3. "Sequence 12 bit tràn thì sao?" → Spin chờ sang ms kế tiếp; 4 096/ms là 4M/s, tràn thật thì tức là một node đang sinh quá nhiều, nên tách node.
4. "Hai instance được cấp cùng node id?" → Chỉ xảy ra khi registry lỗi; dùng ephemeral + lease và kiểm tra lease còn hiệu lực trước mỗi lô ID; alert nếu mất lease.
5. "Nhiều DC thì đồng bộ đồng hồ ra sao?" → Không cần đồng bộ chặt: sắp xếp chỉ cần gần đúng; mỗi DC có bit riêng nên không trùng dù lệch giây.
6. "Tại sao không để DB sinh sequence?" → Cần một round trip tới DB cho mỗi ID và DB thành điểm nghẽn, trái với yêu cầu sinh local; cũng không sắp xếp giữa nhiều DB.
7. "Có thể sinh ID theo lô để tăng tốc không?" → Có: lấy một khoảng sequence hoặc một ms ảo trước; nhưng với 4M/s mỗi node thì thường không cần.
8. "Test tính duy nhất thế nào?" → Chạy 1 000 goroutine sinh 10M ID, đưa vào set, kiểm tra kích thước; test riêng kịch bản đồng hồ lùi bằng clock giả.

### Sai lầm hay gặp
- Nêu "UUID là xong" rồi không trả lời được tác động lên index.
- Quên bit dấu hoặc cộng bit không ra 64.
- Không nhắc clock backwards, hoặc nói "NTP lo rồi".
- Cấp node id bằng config tay rồi không nói chuyện trùng khi autoscale.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Phân tích yêu cầu | Chỉ cần "duy nhất" | Tách 4 yêu cầu: duy nhất, sortable, 64 bit, throughput, không trung tâm |
| So sánh phương án | Một phương án | Bảng 5 phương án, chọn có lý do, nêu khi nào chọn khác |
| Bit layout | Nhớ mang máng | Tính ra 69 năm, 4 096/ms, 1 024 node |
| Tình huống lỗi | Bỏ qua | Clock backwards, trùng node id, sequence tràn |
| Liên hệ DB | Không | B-tree page split, keyset pagination, dung lượng index |

### Nói thế nào trong phỏng vấn (EN)
- "I would go with a Snowflake-style 64-bit ID: 41 bits of milliseconds, 10 bits of node id, 12 bits of sequence." — Snowflake 41 + 10 + 12 bit.
- "Forty-one bits of milliseconds gives us about 69 years from a custom epoch." — 41 bit ms ≈ 69 năm từ epoch tuỳ chỉnh.
- "Time-ordered IDs keep B-tree inserts on the rightmost page, which random UUIDs do not." — ID theo thời gian chèn vào trang phải cùng, UUID ngẫu nhiên thì không.
- "If the clock moves backwards by a few milliseconds I wait; if it is larger I refuse and alert rather than risk duplicates." — Lùi ít thì chờ, lùi nhiều thì từ chối và báo động.
- "Node ids come from etcd with a lease, so autoscaled instances never share one." — Node id lấy từ etcd có lease.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Hầu hết bảng của bạn dùng UUID v4 làm PK: t_policy_violation_scopes 9,6 triệu dòng chỉ có index PK và DB 4 vCPU ghim 100% là ví dụ sống: PK ngẫu nhiên nghĩa là mỗi INSERT chèn vào trang ngẫu nhiên, buffer cache 160 MB không giữ nổi, mọi eval đều đọc đĩa. Chuyển bảng sự kiện (violation, audit log, enrichment attempt) sang UUID v7 hoặc Snowflake int64 giảm page split và cho phép keyset pagination theo id.
- Export dùng OFFSET pagination chậm trên bảng lớn: với id sắp xếp theo thời gian, đổi sang WHERE id > last_id LIMIT 1000 là O(log n) mỗi trang.
- Notification và audit cần idempotency key (C5): một Snowflake id sinh trong apiserver trước khi publish là key dedup tự nhiên, decode ra được thời điểm tạo để debug trễ.
- Việc tuần này: đo kích thước index PK của 3 bảng lớn nhất bằng pg_relation_size và tỉ lệ cache hit từ pg_statio_user_indexes; nếu index gần bằng bảng, viết ADR đề xuất UUID v7 cho bảng mới (Postgres có hàm uuidv7 từ bản 18, trước đó dùng lib Go).
- Lambda enrichment chạy nhiều instance song song không có node id ổn định: nếu cần sinh id trong Lambda, dùng UUID v7 (không cần node id) thay vì Snowflake.
- Câu chuyện phỏng vấn: bảng 9,6 triệu dòng với PK UUID ngẫu nhiên và không có index phụ là ví dụ tốt về "ID ảnh hưởng tới hiệu năng DB thế nào".
`,
  quiz: [
    { t: 'mc', q: 'Trong layout Snowflake chuẩn, 41 bit timestamp mili giây dùng được bao lâu?', o: ['Khoảng 7 năm', 'Khoảng 69 năm', 'Khoảng 690 năm', 'Khoảng 2 năm'], a: 1, why: '2^41 ms ≈ 2,2 × 10^12 ms, chia 3,15 × 10^10 ms mỗi năm ≈ 69 năm.' },
    { t: 'mc', q: 'Vì sao UUID v4 làm PK kém hiệu quả cho B-tree index trên bảng lớn?', o: ['Vì UUID là chuỗi không hash được', 'Vì UUID không duy nhất', 'Vì Postgres không hỗ trợ UUID', 'Vì giá trị ngẫu nhiên khiến INSERT chèn vào trang bất kỳ, gây page split và cache miss'], a: 3, why: 'Key tăng dần chỉ chạm trang phải cùng; key ngẫu nhiên chạm mọi trang và làm index phình.' },
    { t: 'mc', q: 'Nhược điểm chính của ticket server kiểu Flickr là gì?', o: ['Mỗi ID cần một round trip tới DB và DB là điểm nghẽn, SPOF', 'ID không duy nhất', 'ID không nằm trong 64 bit', 'Không chạy được trên MySQL'], a: 0, why: 'Dù có 2 server chẵn lẻ để HA, mọi ID vẫn đi qua một DB nhỏ.' },
    { t: 'mc', q: 'Khi phát hiện đồng hồ hệ thống lùi 3 ms so với last_ts, cách xử lý thực dụng là?', o: ['Dùng thời gian hiện tại như bình thường', 'Reset sequence về 0 và tiếp tục', 'Chờ tới khi thời gian vượt last_ts rồi sinh tiếp', 'Đổi node id ngay lập tức'], a: 2, why: 'Lệch nhỏ thì sleep vài ms là an toàn; dùng thời gian lùi có thể sinh lại ID cũ.' },
    { t: 'mc', q: 'Multi-master auto increment với bước k không đáp ứng yêu cầu nào?', o: ['Duy nhất', '64 bit', 'Số nguyên', 'Sắp xếp theo thời gian giữa các DB và scale ngang linh hoạt'], a: 3, why: 'ID từ các DB khác nhau không có quan hệ thời gian; thêm bớt DB phải đổi k.' },
    { t: 'fill', q: 'Điền: với 12 bit sequence, một node sinh tối đa ___ ID trong một mili giây.', a: ['4096', '4 096', '4.096'], why: '2^12 = 4 096, tương đương khoảng 4 triệu ID mỗi giây mỗi node.' },
    { t: 'fill', q: 'Điền: phiên bản UUID có 48 bit timestamp ở đầu nên sắp xếp được theo thời gian là UUID v___.', a: ['7', 'v7'], why: 'UUID v7 giữ 128 bit nhưng phần đầu là thời gian nên thân thiện với B-tree.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Hệ của anh autoscale từ 10 lên 300 instance trong 1 phút. Làm sao chắc chắn hai instance không dùng chung node id?" Trả lời 3–5 câu.', a: 'Node id không đặt bằng config tay mà xin từ registry như etcd hoặc ZooKeeper lúc khởi động, dưới dạng ephemeral key kèm lease; instance giữ lease bằng heartbeat và ngừng sinh ID nếu mất lease. Id vừa được giải phóng không cấp lại ngay trong vài giây, hoặc registry lưu last_ts của id đó và instance mới phải chờ vượt mốc này, để không trùng với ID sinh ở mili giây cuối của instance cũ. Với 10 bit ta có 1 024 id, đủ cho 300 instance. Nếu không muốn registry, dùng UUID v7 vì nó không cần node id.', keys: ['etcd', 'lease', 'ephemeral', 'last_ts', 'UUID v7'] }
  ]
},
{ id: 'C5', type: 'case', topic: 'queue', title: 'Case: Design a notification system (push, SMS, email)', time: '90 phút',
  goal: 'Thiết kế hệ gửi thông báo đa kênh với queue theo kênh, retry và DLQ, rate limit theo provider, dedup và idempotency, user preference; nối thẳng sang pipeline notification của hệ SBOM.',
  md: `
## Đề bài
> "Design a notification system that sends push notifications, SMS and email to users. Other internal services trigger notifications; we need reliability, user preferences, and tracking whether a message was delivered."

Dịch: thiết kế hệ gửi thông báo push, SMS, email; các service nội bộ kích hoạt thông báo; cần độ tin cậy, tôn trọng thiết lập của user, theo dõi trạng thái gửi. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Kênh nào, provider nào? → Đáp: push (APNs, FCM), SMS (Twilio), email (SES); thiết kế để thêm kênh.
- Hỏi: Ai kích hoạt, khối lượng? → Đáp: 20 service nội bộ; 10M push, 1M SMS, 5M email mỗi ngày.
- Hỏi: Soft realtime hay có thể trễ? → Đáp: OTP phải dưới 10 giây; marketing có thể trễ vài phút; có mức ưu tiên.
- Hỏi: Có cần at-least-once hay exactly-once? → Đáp: không được mất OTP; không được gửi trùng marketing nhiều lần.
- Hỏi: User tắt kênh, giờ yên lặng? → Đáp: có opt-out theo kênh và theo loại; quiet hours cho push.
- Hỏi: Tracking tới mức nào? → Đáp: sent, delivered, opened (email), failed; lưu 90 ngày.
- Hỏi: Template ai quản lý? → Đáp: team sản phẩm, đa ngôn ngữ.

Chốt lại:
**Functional**: API nhận yêu cầu gửi theo user + loại + dữ liệu; chọn kênh theo preference; template đa ngôn ngữ; retry và trạng thái; opt-out; ưu tiên; dedup.
**Non-functional**: không mất message (at-least-once, dedup để gần exactly-once); OTP p95 dưới 10 s; chịu provider chết; 16M message/ngày với đỉnh ×10; tracking lưu 90 ngày.
**Ngoài phạm vi**: soạn nội dung marketing, A/B test, analytics chiến dịch.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Tổng message | 10M + 1M + 5M | 16M/ngày ≈ 185/s trung bình |
| Đỉnh | ×10 khi có sự kiện lớn hoặc batch marketing | ≈ 2 000/s |
| Gọi provider | mỗi message 1 lần, retry trung bình 1,2 | ≈ 2 400 call/s đỉnh; provider thường cho 100–1 000 req/s theo tài khoản → cần hàng đợi và rate limit |
| Lưu trạng thái | 16M × 1 KB (payload rút gọn + events) | 16 GB/ngày, 90 ngày ≈ 1,5 TB |
| Queue backlog khi provider chết 1 giờ | 2 000 × 3 600 | 7,2M message chờ, mỗi message 1 KB → 7 GB, RabbitMQ hoặc Kafka đều ổn |
| Preference lookup | 1 lần mỗi message, cache Redis | 2 000 GET/s, không đáng kể |

Rút ra: khối lượng vừa phải; **điểm khó là độ tin cậy** (provider lỗi, retry, trùng) và **nghiệp vụ preference, ưu tiên**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Svc[Internal services] -> API[Notification API] : POST notify, idempotency key
API -> Pref[Preference and template service]
Pref -> PrefDB[Postgres + Redis cache]
API -> Q[Queue per channel and priority]
Q -> WPush[Push worker] : push.high, push.low
Q -> WSms[SMS worker]
Q -> WMail[Email worker]
WPush -> Prov[APNs, FCM, Twilio, SES] : adapter + rate limit
Prov -> Hook[Webhook receiver] : delivered, bounced
Hook -> Track[Tracking store]
WSms -> Track
Q -> DLQ[Dead letter queue] : sau N lần retry
:::

**Luồng gửi**: service gọi POST /notify kèm idempotency key và loại thông báo → API kiểm tra dedup (Redis SETNX key TTL 24 h) → tra preference: kênh nào bật, quiet hours, ngôn ngữ → render template → ghi bản ghi notification trạng thái queued (trong transaction) → **commit rồi mới publish** vào queue theo kênh và ưu tiên → trả 202 kèm notification_id.
**Luồng worker**: lấy message → lấy token theo provider từ rate limiter → gọi adapter → thành công thì cập nhật sent, ack; lỗi tạm (5xx, timeout) thì nack với delay tăng dần (1 s, 10 s, 1 phút, 10 phút); lỗi vĩnh viễn (token push hết hạn, số điện thoại sai) thì failed ngay; quá 5 lần → DLQ.
**Luồng tracking**: provider gọi webhook (delivered, bounced, opened qua pixel) → cập nhật trạng thái; dashboard đọc tracking store.

API chính:
| Method | Path | Mô tả |
|---|---|---|
| POST | /v1/notifications | body user_id, type, data, priority, idempotency_key → 202 id |
| GET | /v1/notifications/{id} | trạng thái và lịch sử event |
| PUT | /v1/users/{id}/preferences | bật tắt kênh theo loại, quiet hours, ngôn ngữ |
| POST | /v1/templates | tạo template theo type, channel, locale |
| POST | /webhooks/{provider} | nhận trạng thái từ provider, xác thực chữ ký |

Mô hình dữ liệu:
| Bảng | Khoá | Cột chính |
|---|---|---|
| notifications | id (time-ordered) | user_id, type, channel, priority, status, idempotency_key unique, created_at |
| notification_events | (notification_id, ts) | event (queued, sent, delivered, failed), provider_msg_id, error |
| user_preferences | (user_id, type, channel) | enabled, quiet_from, quiet_to, locale |
| templates | (type, channel, locale, version) | subject, body, active |
| devices | (user_id, device_id) | push_token, platform, last_seen |

## 4. Đào sâu (15–18 phút)
### 4.1 Không mất và không trùng
| Vấn đề | Phương án | Chọn |
|---|---|---|
| Mất message khi API chết sau khi nhận | Ghi DB trước rồi publish; hoặc outbox table + relay | **Outbox**: ghi notification và outbox cùng transaction, relay đọc outbox publish; không bao giờ có bản ghi mà không có message |
| Publish trước commit | Consumer nhận trước khi dòng tồn tại → lỗi FK, mất log | Luôn publish sau commit, hoặc dùng outbox |
| Worker chết giữa chừng | Ack sau khi provider trả lời; prefetch nhỏ | Redelivery → gọi provider lần 2 → cần idempotency ở provider (APNs có apns-collapse-id, SES không) → dedup bằng trạng thái trong DB trước khi gọi |
| Caller gọi API 2 lần | Idempotency key unique trong DB + Redis SETNX | Trả lại id cũ với 200 |
| Marketing gửi trùng | Dedup key = (user, campaign) TTL 7 ngày | Chấp nhận hiếm hoi trùng khi Redis mất dữ liệu |

### 4.2 Retry, backoff, DLQ, và phân loại lỗi
- Phân loại lỗi là việc quan trọng nhất: lỗi tạm (timeout, 429, 5xx) → retry với backoff mũ có jitter; lỗi vĩnh viễn (400 invalid token, unsubscribed) → failed ngay và cập nhật devices để không gửi tiếp.
- RabbitMQ không có delay queue sẵn → dùng queue trung gian với TTL và dead-letter về queue chính, hoặc plugin delayed exchange. Kafka → topic retry theo bậc (retry-1m, retry-10m).
- DLQ phải có dashboard và nút "replay"; message trong DLQ phải chứa đủ ngữ cảnh (lỗi cuối, số lần thử).
- Retry không được phá thứ tự OTP: OTP mới nhất thắng → kèm expires_at trong message, worker bỏ qua nếu đã quá hạn.

### 4.3 Rate limit theo provider và ưu tiên
| Phương án | Ưu | Nhược |
|---|---|---|
| Mỗi worker tự giới hạn | Đơn giản | Nhiều worker cộng lại vượt hạn mức |
| Token bucket chung trên Redis theo provider (chọn) | Đúng hạn mức toàn cụm | Thêm round trip; fail-open khi Redis lỗi |
| Hỏi provider và lùi theo 429 | Không cần cấu hình | Phản ứng chậm, bị provider đánh dấu |
Ưu tiên: queue riêng cho high (OTP, bảo mật) và low (marketing); worker high có số lượng riêng để marketing không chiếm hết hạn mức provider; low bị giới hạn ở 70% hạn mức, high lấy phần còn lại và được ưu tiên khi tranh chấp.

### 4.4 Preference, opt-out, template
- Kiểm tra preference ở lúc nhận request (để trả lời sớm) và kiểm tra lại ở worker (vì user có thể tắt trong lúc chờ). Bắt buộc theo luật: SMS marketing phải có opt-out; email có unsubscribe link; transactional (OTP, hoá đơn) không bị chặn bởi opt-out marketing.
- Quiet hours: không gửi push 22h–7h giờ địa phương cho low priority → đưa vào queue delayed tới 7h.
- Template version hoá; message trong queue chứa template_version để render ổn định khi template đổi giữa chừng; render ở API (payload sẵn) hay ở worker (payload nhỏ hơn) đều được, chọn worker để queue nhẹ và cho phép sửa template cho message chưa gửi.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Push token hết hạn thì sao?" → APNs/FCM trả lỗi invalid token; đánh dấu device inactive, không retry; app gửi token mới khi mở lại.
2. "Provider SMS chết 30 phút?" → Message dồn trong queue, retry với backoff; nếu có provider dự phòng thì adapter chuyển sang sau N lỗi liên tiếp (circuit breaker); OTP hết hạn thì bỏ.
3. "Làm sao biết hệ đang chậm?" → Đo tuổi message cũ nhất trong queue (lag) theo kênh và ưu tiên; alert khi OTP lag quá 5 giây; đếm DLQ.
4. "Exactly-once có khả thi không?" → Không ở tầng gửi (provider là bên ngoài); đạt gần bằng idempotency key, trạng thái trong DB trước khi gọi và collapse id của provider.
5. "Kafka hay RabbitMQ?" → RabbitMQ cho routing linh hoạt, ack từng message, DLQ sẵn; Kafka khi cần replay và throughput rất lớn. 2 000/s cả hai đều dư.
6. "Webhook provider gọi trùng hoặc đến trước khi mình ghi sent?" → Idempotent theo provider_msg_id; event đến sớm thì lưu tạm và áp dụng khi có bản ghi.
7. "Gửi 5M email marketing lúc 9h sáng?" → Đây là batch: service marketing publish dần theo tốc độ cho phép (rate limit phía producer), không nhồi 5M vào queue trong 1 phút.
8. "Dữ liệu cá nhân trong queue?" → Chỉ đưa id và dữ liệu cần render, không đưa cả hồ sơ; mã hoá payload nếu có số điện thoại; TTL ngắn.

### Sai lầm hay gặp
- Một queue duy nhất cho mọi kênh và ưu tiên → marketing làm trễ OTP.
- Retry mọi lỗi như nhau, kể cả lỗi vĩnh viễn → spam provider và bị khoá.
- Publish trước khi commit DB.
- Không có DLQ hoặc có DLQ nhưng không ai xem.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Độ tin cậy | "Dùng queue là không mất" | Outbox, ack sau provider, idempotency, phân loại lỗi, DLQ |
| Nghiệp vụ | Bỏ qua preference | Opt-out, quiet hours, transactional vs marketing, template version |
| Scale | Một worker pool | Queue theo kênh và ưu tiên, rate limit theo provider, circuit breaker |
| Quan sát | Không nói | Queue lag theo ưu tiên, DLQ count, tỉ lệ delivered theo provider |
| Mở rộng | Hard-code provider | Adapter interface, thêm kênh không sửa core |

### Nói thế nào trong phỏng vấn (EN)
- "I would separate queues by channel and priority so a marketing burst can never delay an OTP." — Tách queue theo kênh và ưu tiên.
- "The API writes the notification and an outbox row in one transaction, and a relay publishes after commit." — Outbox, publish sau commit.
- "Delivery is at-least-once; I make it effectively exactly-once with an idempotency key and a status check before calling the provider." — At-least-once + idempotency.
- "Transient errors get exponential backoff with jitter; permanent errors fail fast and update the device record." — Phân loại lỗi tạm và vĩnh viễn.
- "A shared token bucket per provider keeps all workers under the vendor rate limit." — Token bucket chung theo provider.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Pipeline notification của bạn: scan xong, policy violation mới, enrichment hoàn tất → publish RabbitMQ → worker gửi email, webhook. Đây chính là hệ này ở quy mô nhỏ, và bạn đã dính đúng các bẫy trong bài.
- Sự cố publisher singleton không reconnect sau khi broker bị recreate: mọi notification và cron im lặng nhiều ngày. Bài học thiết kế: publisher phải có reconnect và health check, và phải có metric "message published trong 10 phút qua" để phát hiện im lặng; outbox table còn cho phép relay bù lại toàn bộ message chưa publish sau khi broker trở lại.
- Sự cố audit log publish trước commit → consumer gặp FK violation và mất log: áp dụng mục 4.1, chuyển sang outbox hoặc publish trong hook sau commit của transaction.
- Reconcile policy xoá mềm violation của lần eval tốt rồi tạo lại: nếu notification bắn theo "violation mới" thì user nhận trùng mỗi vòng. Dedup key = (tenant, project, policy, component, vulnerability) TTL theo chu kỳ reconcile; đồng thời sửa reconcile.
- Scheduled scan notification trễ do reconcile gate 15 phút và sweep 22 phút mỗi tenant: đo tuổi message cũ nhất trong queue theo tenant để chứng minh trễ ở đâu trước khi tối ưu.
- Việc tuần này: thêm bảng notification_outbox và relay 1 giây; thêm metric publish_total và queue_oldest_age_seconds; viết ADR "publish sau commit, bắt buộc idempotency key cho mọi message".
- Khi khách Nhật hỏi "tại sao không nhận được email policy violation hôm qua", bạn cần trả lời được từ tracking events, không phải từ log container.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao nên tách queue theo kênh và theo ưu tiên?', o: ['Để giảm dung lượng queue', 'Để một đợt marketing lớn không làm trễ OTP và để worker mỗi kênh scale độc lập', 'Vì RabbitMQ chỉ cho một consumer mỗi queue', 'Để không cần DLQ'], a: 1, why: 'Queue chung FIFO khiến message khẩn xếp sau hàng triệu message marketing; tách queue cô lập tác động và cho phép rate limit riêng.' },
    { t: 'mc', q: 'Outbox pattern giải quyết vấn đề gì?', o: ['Giảm độ trễ gửi', 'Mã hoá payload', 'Đảm bảo bản ghi DB và message publish luôn nhất quán, không publish trước commit và không mất message khi API chết', 'Thay thế retry'], a: 2, why: 'Outbox ghi cùng transaction với dữ liệu; relay đọc và publish sau khi commit, có thể bù khi broker chết.' },
    { t: 'mc', q: 'Provider trả lỗi "invalid device token". Worker nên làm gì?', o: ['Retry với backoff như lỗi mạng', 'Đưa vào DLQ để xem sau', 'Chờ 1 giờ rồi thử lại', 'Đánh dấu failed ngay, cập nhật device inactive, không retry'], a: 3, why: 'Đây là lỗi vĩnh viễn; retry chỉ spam provider và có thể bị khoá tài khoản.' },
    { t: 'mc', q: 'Cách đúng để nhiều worker cùng tuân thủ hạn mức 500 req/s của một provider là gì?', o: ['Token bucket chung trên Redis theo provider', 'Mỗi worker tự giới hạn 500 req/s', 'Giảm số worker xuống 1', 'Để provider trả 429 rồi mới lùi'], a: 0, why: 'Giới hạn local cộng dồn theo số worker; counter chung mới đúng hạn mức toàn cụm.' },
    { t: 'mc', q: 'Metric nào phản ánh tốt nhất việc hệ notification đang chậm?', o: ['CPU của worker', 'Số message đã gửi trong ngày', 'Tuổi của message cũ nhất trong queue theo ưu tiên', 'Số kết nối tới RabbitMQ'], a: 2, why: 'Queue lag theo ưu tiên cho biết OTP đang chờ bao lâu; throughput cao vẫn có thể đang trễ.' },
    { t: 'fill', q: 'Điền: message thất bại quá số lần retry cho phép được chuyển vào ___ queue để xem xét và replay thủ công.', a: ['dead letter', 'dead-letter', 'dlq', 'dead letter queue'], why: 'DLQ giữ message lỗi kèm ngữ cảnh thay vì bỏ hoặc retry vô hạn.' },
    { t: 'fill', q: 'Điền: caller gửi kèm ___ key để API nhận ra request lặp lại và trả về kết quả cũ thay vì gửi trùng.', a: ['idempotency', 'idempotent', 'idempotency key'], why: 'Unique constraint trên key này trong DB cộng Redis SETNX cho dedup nhanh.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Worker gọi provider thành công nhưng chết trước khi ack. Message được giao lại. Anh tránh gửi trùng thế nào?" Trả lời 3–5 câu.', a: 'Trước khi gọi provider, worker cập nhật trạng thái sending trong DB với điều kiện trạng thái hiện tại là queued; lần giao lại thấy trạng thái sending hoặc sent thì không gọi nữa mà chỉ kiểm tra lại với provider hoặc chờ webhook. Với provider hỗ trợ idempotency như APNs collapse id hoặc Twilio idempotency key thì gửi kèm để provider tự khử trùng. Chấp nhận at-least-once ở tầng vận chuyển và đạt gần exactly-once bằng trạng thái trong DB cộng key phía provider. Prefetch nhỏ và ack ngay sau khi ghi sent để thu hẹp cửa sổ này.', keys: ['trạng thái', 'idempotency', 'at-least-once', 'ack', 'provider'] }
  ]
},
{ id: 'C6', type: 'case', topic: 'scale', title: 'Case: Design a news feed (Facebook, Twitter)', time: '120 phút',
  goal: 'Giải thích và chọn giữa fan-out on write, fan-out on read và hybrid cho celebrity; thiết kế feed cache bằng Redis, luồng đăng bài và đọc feed, ước lượng cho 300M DAU và nêu điểm nghẽn.',
  md: `
## Đề bài
> "Design the news feed for a social network like Facebook or Twitter: users post content, follow others, and see a feed of recent posts from people they follow. Assume 300 million daily active users."

Dịch: thiết kế news feed cho mạng xã hội; user đăng bài, theo dõi người khác, xem feed các bài mới từ người mình theo dõi; 300 triệu DAU. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Feed theo thời gian hay có ranking? → Đáp: ưu tiên thời gian, có chỗ cho ranking sau.
- Hỏi: Bài có ảnh, video? → Đáp: có, nhưng feed chỉ trả metadata và URL, media đi CDN.
- Hỏi: Số follow trung bình và tối đa? → Đáp: trung bình 200, một số tài khoản có 10M+ follower.
- Hỏi: Feed phải thấy bài mới sau bao lâu? → Đáp: vài giây là tốt, 1 phút chấp nhận được.
- Hỏi: Có hiển thị bài quảng cáo, gợi ý không? → Đáp: ngoài phạm vi.
- Hỏi: Mobile và web đều dùng? → Đáp: có, API chung, phân trang.

Chốt lại:
**Functional**: đăng bài (text + media), follow/unfollow, lấy feed phân trang theo thời gian, like/comment đếm số (không đi sâu).
**Non-functional**: feed p99 dưới 500 ms khi mở app; bài mới xuất hiện trong feed follower trong vài giây đến 1 phút; 300M DAU; không mất bài; eventual consistency chấp nhận được cho feed.
**Ngoài phạm vi**: ranking bằng ML chi tiết, ads, search, messenger.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Bài đăng | 300M × 0,5 bài/ngày | 150M bài/ngày ≈ 1 700/s, đỉnh ≈ 5 000/s |
| Đọc feed | 300M × 10 lần mở/ngày | 3 tỷ/ngày ≈ 35k QPS, đỉnh ≈ 100k QPS |
| Fan-out on write | 150M bài × 200 follower | 30 tỷ lần chèn feed/ngày ≈ 350k chèn/s |
| Celebrity 10M follower đăng 1 bài | 10M chèn | vài phút với 1 worker pool, không chấp nhận được |
| Feed cache | 300M user × 500 post id × 8 B | 1,2 TB; chỉ giữ user hoạt động 30 ngày (1/3) và 300 id → ~240 GB Redis cluster |
| Lưu bài 1 năm | 150M × 365 × 1 KB metadata | ≈ 55 TB chưa kể media |
| Media | 30% bài có ảnh 500 KB | 150M × 0,3 × 500 KB ≈ 22 TB/ngày lên object storage và CDN |

Rút ra: đọc gấp 20 lần ghi và cần nhanh → **tính trước feed (fan-out on write)** cho đa số; nhưng celebrity phá vỡ mô hình → **hybrid**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Mobile/Web] -> LB[Load balancer]
LB -> PostSvc[Post service]
LB -> FeedSvc[Feed service]
PostSvc -> PostDB[Post DB shard theo post_id]
PostSvc -> Media[Object storage + CDN] : upload ảnh
PostSvc -> MQ[Kafka post_created]
MQ -> Fanout[Fan-out workers]
Fanout -> Graph[Social graph service] : lấy follower
Fanout -> FeedCache[Redis feed cache per user]
FeedSvc -> FeedCache : lấy post id
FeedSvc -> PostCache[Post cache Redis] : hydrate nội dung
FeedSvc -> Graph : celebrity follow list
:::

**Luồng đăng bài**: client upload media lấy URL → POST /posts → Post service ghi PostDB, ghi Post cache → publish post_created vào Kafka → Fan-out worker lấy danh sách follower từ Graph service → với mỗi follower (không phải celebrity nguồn) thêm post_id vào feed cache của follower → cắt feed cache còn 300 id.
**Luồng đọc feed**: GET /feed?cursor → Feed service đọc 20 post id từ feed cache của user → gộp với bài mới của celebrity mà user theo dõi (đọc trực tiếp từ Post cache theo author) → sắp xếp theo thời gian → hydrate nội dung từ Post cache (miss thì PostDB) → trả kèm user info (User cache) → cursor là post_id cuối (time-ordered id).

API chính:
| Method | Path | Mô tả |
|---|---|---|
| POST | /v1/posts | body text, media_ids → 201 post |
| GET | /v1/feed?cursor=&limit=20 | 20 bài kế tiếp, cursor = post_id cuối |
| POST | /v1/follows/{user_id} | theo dõi; DELETE để bỏ |
| GET | /v1/users/{id}/posts?cursor= | timeline của một người (không qua feed cache) |
| POST | /v1/posts/{id}/like | đếm bất đồng bộ |

Mô hình dữ liệu:
| Bảng hoặc cấu trúc | Khoá | Nội dung |
|---|---|---|
| posts | post_id (Snowflake) | author_id, text, media_urls, created_at |
| follows | (follower_id, followee_id) + index ngược | created_at; Graph service sở hữu |
| feed:{user_id} (Redis list hoặc sorted set) | user_id | 300 post_id mới nhất, score = post_id |
| post:{post_id} (Redis hash) | post_id | nội dung đã serialize, TTL 1 ngày |
| celebrity set | user_id | author có trên 1M follower, dùng cho hybrid |

## 4. Đào sâu (15–18 phút)
### 4.1 Fan-out on write, on read, hay hybrid
| Phương án | Cách làm | Ưu | Nhược |
|---|---|---|---|
| Fan-out on write (push) | Khi đăng bài, đẩy post_id vào feed cache của mọi follower | Đọc feed cực nhanh, chỉ 1 lần đọc cache | Ghi khuếch đại 200 lần; celebrity 10M follower tốn hàng phút; lãng phí cho user không hoạt động |
| Fan-out on read (pull) | Khi mở feed, lấy follow list, đọc bài mới của từng người, merge | Không lãng phí, bài mới ngay lập tức | Đọc 200 timeline mỗi lần mở feed → p99 kém, tải đọc khổng lồ |
| Hybrid (chọn) | Push cho author thường; pull cho celebrity; merge lúc đọc | Đọc nhanh cho 99% nội dung, celebrity không làm nghẽn worker | Logic merge phức tạp hơn, phải duy trì danh sách celebrity |
Chi tiết hybrid: ngưỡng celebrity 1M follower (hoặc theo chi phí fan-out); fan-out bỏ qua follower không hoạt động 30 ngày (khi họ quay lại, build feed bằng pull một lần rồi chuyển sang push). Thứ tự fan-out ưu tiên follower đang online.

### 4.2 Feed cache
- Redis **sorted set** với score = post_id (time-ordered) cho phép ZREVRANGEBYSCORE theo cursor, loại trùng tự nhiên; Redis **list** nhẹ hơn nhưng không chèn theo thứ tự khi bài đến muộn. Chọn sorted set, ZADD rồi ZREMRANGEBYRANK giữ 300 phần tử.
- Cache chỉ chứa id, không chứa nội dung: nội dung thay đổi (sửa, xoá) chỉ sửa một chỗ ở Post cache; feed cache của 300M user không phải cập nhật.
- Xoá bài: xoá khỏi Post cache và đánh dấu deleted trong PostDB; feed cache còn id nhưng hydrate không ra → bỏ qua. Không cần quét 200 feed để xoá.
- Mất Redis: feed cache có thể dựng lại bằng pull từ Graph + Post DB; vì vậy không cần persistence cho Redis feed, chỉ cần replica.

### 4.3 Hot path đọc feed và hydrate
- Mỗi lần đọc feed là 1 ZREVRANGE + 1 MGET 20 post + 1 MGET user info; tất cả trong Redis cluster → p99 vài chục ms.
- Post của celebrity: đọc 10 bài mới nhất của mỗi celebrity user theo dõi (thường dưới 50 người) từ cache author_posts:{author_id}, merge k-way theo post_id.
- Post cache miss hàng loạt khi bài cũ: PostDB shard theo post_id với replica; batch get theo shard.

### 4.4 Ranking và các việc bất đồng bộ
- Ranking: lấy 300 ứng viên từ feed cache, chấm điểm bằng model nhẹ (recency, affinity, loại nội dung) trong Feed service, trả 20; hoặc precompute điểm khi fan-out. Nói rõ ranking là mở rộng, không đổi kiến trúc.
- Like, comment, view count: ghi vào Kafka, aggregator cập nhật counter trong Redis và DB theo lô; không ghi trực tiếp vào PostDB mỗi like.
- Media: upload thẳng lên object storage bằng presigned URL, CDN phân phối; feed chỉ chứa URL.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Unfollow rồi feed còn bài của người đó?" → Lọc lúc đọc theo follow list hiện tại (cache), hoặc chấp nhận bài cũ còn trong 300 id cho tới khi trôi; không quét xoá.
2. "Bài celebrity xuất hiện chậm hơn bài thường?" → Ngược lại, pull đọc trực tiếp nên tức thì; push mới có độ trễ fan-out vài giây.
3. "Fan-out worker chậm, backlog 10 phút?" → Scale worker theo lag Kafka; ưu tiên follower online; bỏ qua follower không hoạt động; đo lag là metric số 1.
4. "User mới đăng ký, feed trống?" → Build bằng pull một lần từ các người vừa follow, rồi chuyển sang push.
5. "Sửa bài sau khi đăng?" → Post cache và DB sửa, feed cache chỉ chứa id nên không cần động.
6. "Đọc feed khi Redis cluster mất 1 shard?" → Fallback pull cho user trong shard đó, chậm hơn nhưng vẫn trả được; replica Redis giảm xác suất.
7. "Shard PostDB theo gì?" → Theo post_id (phân bố đều, lấy theo id nhanh); timeline của một author cần index phụ hoặc bảng author_posts riêng.
8. "Chống trùng bài khi Kafka giao lại?" → ZADD idempotent theo member nên fan-out trùng vô hại; đó là lý do chọn sorted set.
9. "300M DAU nhưng chỉ 1/3 mở app mỗi ngày?" → Chỉ giữ feed cache cho user hoạt động; số còn lại dựng lại khi quay lại.

### Sai lầm hay gặp
- Chỉ nói fan-out on write rồi bị hỏi celebrity là đứng.
- Lưu cả nội dung bài trong feed cache của từng user → 300M bản sao, sửa bài là ác mộng.
- Ghi like trực tiếp vào bảng posts.
- Không có cursor phân trang, dùng OFFSET trên feed.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Mô hình fan-out | Một phương án | Push, pull, hybrid; ngưỡng celebrity; bỏ qua user không hoạt động |
| Ước lượng | Quên khuếch đại ghi | 350k chèn/s, 240 GB feed cache, 22 TB media/ngày |
| Cấu trúc dữ liệu | "Dùng Redis" | Sorted set score = post_id, chỉ lưu id, cắt 300 |
| Luồng đọc | Mơ hồ | ZREVRANGE + merge celebrity + hydrate MGET, cursor keyset |
| Vận hành | Không | Kafka lag, Redis mất shard fallback, counter bất đồng bộ |

### Nói thế nào trong phỏng vấn (EN)
- "Reads outnumber writes about twenty to one, so I precompute feeds with fan-out on write for most users." — Đọc gấp 20 lần ghi nên tính trước feed.
- "For accounts with millions of followers I switch to fan-out on read and merge at query time; that is the hybrid approach." — Celebrity dùng pull, merge lúc đọc.
- "The feed cache stores only post ids in a sorted set keyed by a time-ordered id, so edits and deletes touch one place." — Cache chỉ chứa id.
- "I skip fan-out for users inactive for thirty days and rebuild their feed on demand." — Bỏ qua user không hoạt động.
- "Kafka consumer lag on the fan-out topic is the first metric I would alert on." — Lag fan-out là metric cảnh báo đầu tiên.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Dashboard tenant của bạn (số vulnerability theo severity, distribution theo project, violation mới) chính là bài toán "feed": tính trước (fan-out on write vào t_project_metrics khi scan xong) hay tính lúc đọc (query gộp mỗi lần mở trang). Sự cố distribution biến mất vì snapshot t_project_metrics không được tạo khi chain upload 15 phút one-shot lỗi là bệnh kinh điển của fan-out on write: thiếu cơ chế dựng lại khi quay lại (pull fallback).
- Áp dụng hybrid: project nhỏ tính lúc đọc (rẻ), project lớn 90k component (celebrity của bạn) tính trước và lưu snapshot, có job reconcile dựng lại snapshot thiếu.
- Danh sách thông báo và violation mới theo tenant có thể giữ trong Redis sorted set score = id time-ordered, chỉ chứa id, cắt 500; FE phân trang bằng cursor thay vì OFFSET (sự cố export OFFSET + FDW chậm).
- Like/view count bất đồng bộ tương ứng với counter "số component pending enrichment" mà bạn đang COUNT trực tiếp trên bảng lớn mỗi lần mở trang; chuyển sang counter cập nhật theo lô.
- Việc tuần này: liệt kê 5 truy vấn dashboard chậm nhất từ pg_stat_statements, phân loại mỗi cái là "tính trước" hay "tính lúc đọc", và chọn hybrid có fallback rõ ràng; viết ADR cho t_project_metrics: ai tạo, khi nào dựng lại, dựa vào đâu để biết thiếu.
- Metric cần có: lag của queue tạo snapshot và số project không có snapshot quá 1 giờ sau scan.
`,
  quiz: [
    { t: 'mc', q: 'Vấn đề lớn nhất của fan-out on write thuần tuý là gì?', o: ['Đọc feed chậm', 'Tài khoản có hàng triệu follower tạo hàng triệu lần chèn cho một bài, và lãng phí cho user không hoạt động', 'Không hỗ trợ phân trang', 'Redis không chứa được post id'], a: 1, why: 'Khuếch đại ghi tỉ lệ số follower; celebrity làm nghẽn worker, user không hoạt động nhận feed vô ích.' },
    { t: 'mc', q: 'Trong mô hình hybrid, bài của celebrity được đưa vào feed bằng cách nào?', o: ['Push vào feed cache của mọi follower như bình thường', 'Chỉ gửi push notification', 'Lưu trong feed cache của chính celebrity', 'Đọc trực tiếp từ cache bài của author lúc user mở feed rồi merge với feed cache'], a: 3, why: 'Pull lúc đọc cho số ít author lớn, push cho phần còn lại; merge theo post_id.' },
    { t: 'mc', q: 'Vì sao feed cache chỉ nên chứa post id thay vì nội dung bài?', o: ['Để sửa hoặc xoá bài chỉ cần động vào một chỗ và cache nhỏ hơn hàng trăm lần', 'Vì Redis không lưu được chuỗi dài', 'Để tăng độ trễ', 'Vì post id dễ nén'], a: 0, why: 'Nội dung nhân bản theo số follower là lãng phí và không nhất quán khi sửa; hydrate từ Post cache dùng chung.' },
    { t: 'mc', q: 'Dùng Redis sorted set với score = post_id time-ordered mang lại lợi ích gì khi fan-out worker nhận lại message trùng từ Kafka?', o: ['Tăng tốc ghi', 'ZADD idempotent theo member nên chèn trùng vô hại và vẫn đúng thứ tự thời gian', 'Giảm bộ nhớ một nửa', 'Không cần cắt feed'], a: 1, why: 'Sorted set loại trùng tự nhiên và sắp theo score, nên redelivery không tạo bài lặp.' },
    { t: 'mc', q: 'Với 150M bài/ngày và trung bình 200 follower, số lần chèn feed mỗi giây xấp xỉ?', o: ['3 500/s', '35 000/s', '350 000/s', '3 500 000/s'], a: 2, why: '150M × 200 = 30 tỷ chèn/ngày; chia 86 400 s ≈ 350k/s.' },
    { t: 'fill', q: 'Điền: cách lấy feed bằng việc đọc bài mới của từng người mình theo dõi rồi gộp lúc mở app gọi là fan-out on ___.', a: ['read', 'on read'], why: 'Pull tốn tải đọc mỗi lần mở feed nhưng không lãng phí ghi; dùng cho celebrity trong hybrid.' },
    { t: 'fill', q: 'Điền: phân trang feed nên dùng ___ là post_id cuối cùng thay vì OFFSET để ổn định khi có bài mới chèn vào.', a: ['cursor', 'keyset', 'cursor keyset'], why: 'Cursor theo id time-ordered cho trang kế tiếp O(log n) và không lặp bài khi feed thay đổi.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Một user không mở app 6 tháng rồi quay lại. Feed của họ đã bị bỏ qua khi fan-out. Anh xử lý thế nào?" Trả lời 3–5 câu.', a: 'Khi mở feed mà feed cache rỗng hoặc có cờ inactive, Feed service dựng feed bằng pull một lần: lấy follow list từ Graph service, đọc 10–20 bài mới nhất của mỗi người từ author_posts cache hoặc PostDB, merge theo post_id và ghi vào feed cache. Sau đó đánh dấu user active để fan-out worker đẩy bài mới cho họ như bình thường. Lần đầu chậm hơn vài trăm ms nhưng chỉ xảy ra một lần. Cách này cho phép bỏ qua user không hoạt động khi fan-out mà không mất trải nghiệm.', keys: ['pull', 'follow list', 'merge', 'feed cache', 'active'] }
  ]
},
{ id: 'C7', type: 'case', topic: 'realtime', title: 'Case: Design a chat system (WhatsApp, Messenger)', time: '120 phút',
  goal: 'Thiết kế chat 1-1 và nhóm với WebSocket gateway, service discovery, message store wide-column, thứ tự message, presence, receipts, offline push, multi-device sync và phác hoạ end-to-end encryption.',
  md: `
## Đề bài
> "Design a messaging system like WhatsApp or Messenger: one-to-one and group chats, online presence, delivery and read receipts, and messages must arrive even if the recipient is offline."

Dịch: thiết kế hệ nhắn tin kiểu WhatsApp; chat 1-1 và nhóm; trạng thái online; biên nhận đã nhận và đã đọc; người nhận offline vẫn phải nhận được tin. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Quy mô? → Đáp: 50M DAU, trung bình 40 tin/người/ngày.
- Hỏi: Kích thước nhóm tối đa? → Đáp: 500 thành viên.
- Hỏi: Chỉ text hay có media? → Đáp: text là chính; media gửi qua object storage, chat chỉ chuyển URL.
- Hỏi: Lưu lịch sử bao lâu? → Đáp: vĩnh viễn cho tới khi user xoá.
- Hỏi: Nhiều thiết bị cùng tài khoản? → Đáp: có, tối đa 5 thiết bị, phải đồng bộ.
- Hỏi: Mã hoá đầu cuối bắt buộc không? → Đáp: nói sơ lược là đủ, tập trung hạ tầng.
- Hỏi: Độ trễ chấp nhận? → Đáp: tin đến thiết bị online trong dưới 1 giây.

Chốt lại:
**Functional**: gửi nhận 1-1 và nhóm; presence; receipts (sent, delivered, read); offline → push notification và nhận lại khi online; multi-device sync; lịch sử phân trang.
**Non-functional**: độ trễ end-to-end dưới 1 s; không mất tin; thứ tự tin trong một hội thoại nhất quán trên mọi thiết bị; 50M DAU, 10M kết nối đồng thời; sẵn sàng 99,99%.
**Ngoài phạm vi**: gọi thoại/video, story, bot platform, tìm kiếm toàn văn.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Tin nhắn | 50M × 40 | 2 tỷ tin/ngày ≈ 23k/s, đỉnh ≈ 70k/s |
| Dung lượng tin | 100 B text + 100 B metadata | 2 tỷ × 200 B = 400 GB/ngày ≈ 146 TB/năm (chưa replication) |
| Kết nối đồng thời | 20% DAU online cùng lúc | 10M WebSocket |
| Gateway | mỗi node giữ 200k–500k kết nối (tối ưu kernel, ~10 KB/kết nối) | 20–50 gateway, mỗi gateway 5–10 GB RAM cho kết nối |
| Presence update | 10M user, mỗi thay đổi fan-out tới ~50 bạn online | hàng trăm nghìn sự kiện/s nếu không debounce → phải gom |
| Push offline | 30% tin tới user offline | 600M push/ngày ≈ 7k/s tới APNs, FCM |

Rút ra: ghi nhiều, đọc theo hội thoại, dữ liệu tăng không ngừng → **wide-column store partition theo hội thoại**; **kết nối lâu dài** là tài nguyên cần quản lý riêng.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
A[Client A] -> LB[L4 load balancer] : WebSocket
LB -> GW1[WS gateway 1]
GW1 -> Chat[Chat service] : send
Chat -> IDGen[Message id generator]
Chat -> Store[Message store Cassandra] : ghi
Chat -> Disc[Session registry Redis user to gateway]
Chat -> GW2[WS gateway 2] : đẩy tới B
GW2 -> B[Client B]
Chat -> MQ[Kafka] : offline, receipts
MQ -> Push[Push service APNs FCM]
GW1 -> Pres[Presence service] : heartbeat
Pres -> PresDB[Redis TTL]
:::

**Luồng gửi 1-1**: A gửi tin qua WebSocket tới GW1 kèm client_msg_id → GW1 chuyển Chat service → sinh message_id (Snowflake, tăng theo thời gian) → ghi Message store (chờ ack quorum) → trả ack "sent" cho A → tra Session registry: B đang ở GW2? → đẩy tin tới GW2 → GW2 ghi xuống B → B ack → Chat ghi receipt delivered → báo A. B offline → publish vào Kafka → Push service gửi APNs/FCM với nội dung rút gọn.
**Luồng online lại**: B kết nối → đăng ký (user, device) → GW vào registry → B gửi cursor last_message_id theo hội thoại → Chat trả các tin có id lớn hơn cursor.
**Luồng nhóm**: tin ghi 1 lần theo channel_id; fan-out tới từng thành viên online qua gateway; thành viên offline nhận lúc sync. Nhóm 500 người → tối đa 500 lần đẩy, chấp nhận được.

API chính (qua WebSocket frame hoặc HTTP):
| Kênh | Lệnh | Mô tả |
|---|---|---|
| WS | send {channel_id, client_msg_id, body} | server trả ack {message_id, ts} |
| WS | receipt {message_id, type delivered/read} | chuyển cho người gửi |
| WS | presence subscribe [user_ids] | nhận cập nhật online/offline của danh bạ |
| HTTP | GET /v1/channels/{id}/messages?before=&limit=50 | lịch sử phân trang |
| HTTP | POST /v1/channels | tạo nhóm, thêm thành viên |
| HTTP | GET /v1/sync?since= | đồng bộ khi mở app, trả thay đổi mọi hội thoại |

Mô hình dữ liệu:
| Bảng | Partition key | Clustering key | Cột |
|---|---|---|---|
| messages | channel_id | message_id DESC | sender_id, body (ciphertext), type, created_at |
| channels | channel_id | | type (1-1, group), members, created_at |
| user_channels | user_id | last_message_id DESC | channel_id, unread_count, muted |
| receipts | channel_id | (message_id, user_id) | delivered_at, read_at |
| sessions (Redis) | user_id | | hash device_id → gateway_id, TTL 60 s heartbeat |
| presence (Redis) | user_id | | last_seen, status, TTL 30 s |

## 4. Đào sâu (15–18 phút)
### 4.1 WebSocket gateway và service discovery
| Vấn đề | Phương án | Chọn |
|---|---|---|
| Biết B đang nối vào gateway nào | Registry Redis user → gateway với TTL heartbeat; hoặc pub/sub broadcast tới mọi gateway | Registry (chính xác, O(1)); pub/sub theo user_id là phương án B khi registry lỗi |
| Gateway chết mất 300k kết nối | Client reconnect với backoff + jitter; LB không gửi tới node unhealthy; tin trong lúc đó coi như offline → sync lại bằng cursor | Thiết kế để mất gateway chỉ gây trễ, không mất tin, vì tin đã ghi store trước khi đẩy |
| Gateway stateless hay stateful | Gateway chỉ giữ kết nối, mọi logic ở Chat service | Scale và deploy gateway độc lập; drain kết nối từ từ khi deploy |
| Hairpin, NAT, proxy cắt kết nối idle | Ping/pong 30 s, LB idle timeout lớn hơn | Tránh reconnect bão |

### 4.2 Thứ tự message và message id
- Cần thứ tự nhất quán **trong một hội thoại** trên mọi thiết bị, không cần thứ tự toàn cục. Phương án: (a) timestamp client → sai vì clock; (b) counter theo channel trong Redis INCR → đúng thứ tự tuyệt đối nhưng thêm round trip và Redis thành dependency; (c) Snowflake từ Chat service → gần đúng theo thời gian, đủ tốt, không round trip; thứ tự hiển thị theo message_id; hai tin cách nhau 1 ms từ 2 node khác nhau có thể đảo nhưng user không nhận ra.
- Chọn (c); nếu người phỏng vấn ép strict ordering cho nhóm → (b) với counter theo channel, chấp nhận chi phí.
- client_msg_id để dedup khi client gửi lại sau mất kết nối: server giữ (sender, client_msg_id) trong 24 h.

### 4.3 Presence
- Online khi WebSocket mở và heartbeat 10 s; offline khi mất heartbeat quá 30 s (TTL Redis). Không báo offline ngay khi mất kết nối vì mạng di động chập chờn → chờ TTL (debounce) để tránh nhấp nháy.
- Fan-out presence: chỉ gửi tới bạn bè **đang online và đang mở danh sách chat**; nhóm lớn không hiện presence từng người. Gom thay đổi theo 5–10 s.
- Last seen là eventual; không ai cần chính xác tới giây.

### 4.4 Multi-device sync và receipts
- Mỗi (user, device) có cursor riêng theo hội thoại: last_delivered_id. Tin tới user được đẩy tới mọi thiết bị online; thiết bị offline sync khi mở app bằng GET /sync?since=.
- Read receipt phát ra từ thiết bị đã đọc, áp dụng cho cả user: read_at theo (channel, message, user), không theo thiết bị; các thiết bị khác nhận receipt để cập nhật unread.
- Unread count tính từ last_read_id của user với message_id mới nhất của channel, không đếm từng tin.

### 4.5 End-to-end encryption (sơ lược)
- Server chỉ lưu ciphertext; khoá phiên trao đổi bằng giao thức kiểu Signal (X3DH + Double Ratchet) giữa thiết bị. Nhóm dùng sender key để không mã hoá 500 lần. Hệ quả hạ tầng: server không tìm kiếm nội dung được; push chỉ gửi "bạn có tin mới"; multi-device phải mã hoá cho từng thiết bị. Nói sơ lược rồi quay về hạ tầng.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Vì sao Cassandra mà không Postgres?" → Ghi 70k/s tăng không ngừng, truy vấn luôn theo channel_id và theo thứ tự id → wide-column partition theo channel là khớp; Postgres phải shard tay và partition theo thời gian.
2. "Partition theo channel_id có hot partition không?" → Nhóm 500 người chat liên tục vẫn chỉ vài trăm tin/giây, chấp nhận được; channel siêu lớn (kênh broadcast triệu người) là bài khác, thêm bucket theo ngày vào partition key.
3. "Tin được ghi store nhưng đẩy tới B thất bại?" → B sync bằng cursor khi kết nối lại; delivered receipt chỉ phát khi B ack nên A thấy đúng trạng thái.
4. "Kafka ở đâu trong luồng chính?" → Không nằm trên đường nóng gửi tin (để giữ dưới 1 s); dùng cho offline push, receipts, analytics.
5. "WebSocket hay long polling?" → WebSocket cho hai chiều và tiết kiệm header; long polling là fallback khi proxy chặn.
6. "Gateway 500k kết nối thì giới hạn ở đâu?" → File descriptor, bộ nhớ mỗi kết nối (~10 KB với Go goroutine nhẹ), và sự kiện presence; Go epoll qua netpoller chịu tốt.
7. "Xoá tin cho mọi người?" → Ghi tombstone message type delete, client ẩn; không xoá vật lý ngay vì thiết bị offline cần nhận lệnh xoá.
8. "Rate limit spam?" → Giới hạn tin/giây theo user ở Chat service (C2), chặn gửi tới người không phải liên hệ với ngưỡng thấp.

### Sai lầm hay gặp
- Để HTTP request/response cho chat rồi "poll mỗi giây".
- Lưu tin theo user (nhân bản theo số thành viên) thay vì theo channel.
- Dùng timestamp client làm thứ tự.
- Quên multi-device: cursor theo user thay vì theo thiết bị.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Kết nối realtime | "Dùng WebSocket" | Gateway stateless, registry user → gateway, reconnect, drain |
| Lưu trữ | Bảng messages trong MySQL | Wide-column partition channel_id, clustering message_id, ước lượng 146 TB/năm |
| Thứ tự và tin cậy | Timestamp | Snowflake id, client_msg_id dedup, ghi trước đẩy sau, cursor sync |
| Nhóm và presence | Fan-out mọi thứ | Giới hạn 500, debounce presence, chỉ gửi cho người đang xem |
| Multi-device | Bỏ qua | Cursor theo thiết bị, receipt theo user |

### Nói thế nào trong phỏng vấn (EN)
- "Gateways only hold connections; all logic lives in a stateless chat service, so I can scale and deploy them independently." — Gateway chỉ giữ kết nối.
- "I write the message to the store first and only then push it; if the push fails the recipient catches up with a cursor." — Ghi trước, đẩy sau, sync bằng cursor.
- "Messages are partitioned by channel id and clustered by a time-ordered message id, which matches the only query we need." — Partition theo channel, cluster theo id.
- "Presence is eventually consistent by design; I debounce offline by thirty seconds to avoid flapping." — Presence eventual, debounce 30 s.
- "Each device keeps its own delivery cursor, while read receipts are per user." — Cursor theo thiết bị, read receipt theo user.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- FE Next.js của bạn hiện biết scan xong hay có violation mới bằng cách tải lại trang hoặc polling. Một WebSocket hoặc SSE gateway nhỏ (Go, stateless, registry tenant → kết nối trong Redis) cho phép worker đẩy "scan hoàn tất, N violation" ngay khi RabbitMQ consumer xử lý xong; tenant chỉ vài trăm kết nối nên một gateway là đủ, nhưng thiết kế registry ngay để sau này thêm node.
- Sự cố publisher RabbitMQ singleton không reconnect là bài học giống hệt gateway mất kết nối: mọi kết nối lâu dài (AMQP channel, WebSocket, DB pool) phải có heartbeat, reconnect với backoff và metric "kết nối sống". Viết một package conn với vòng lặp reconnect dùng chung cho AMQP và WS.
- Thứ tự sự kiện: audit log và notification của bạn hiện dựa vào created_at từ nhiều process (apiserver, worker, Lambda) với đồng hồ khác nhau. Snowflake id hoặc UUID v7 sinh tại nơi ghi cho thứ tự ổn định trong một tenant (nối C4).
- Cursor sync: FE lấy "thay đổi từ since=" thay vì tải lại toàn bộ danh sách violation 10k dòng; API GET /sync?since=last_id trên bảng có id time-ordered là O(log n).
- Việc tuần này: đo số request polling từ FE trong 1 giờ trên pilot (access log nginx) để lượng hoá chi phí; prototype SSE endpoint trong apiserver cho sự kiện scan_completed; viết ADR về reconnect policy chung.
- Khi phỏng vấn, kể chuyện "cron im lặng nhiều ngày vì publisher không reconnect" khi được hỏi về kết nối lâu dài và cách phát hiện im lặng.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao Chat service ghi tin vào store trước rồi mới đẩy tới người nhận?', o: ['Để giảm độ trễ', 'Để nếu đẩy thất bại hoặc gateway chết, tin vẫn tồn tại và người nhận sync lại bằng cursor', 'Vì WebSocket không gửi được trước khi ghi', 'Để tiết kiệm bộ nhớ gateway'], a: 1, why: 'Tin bền trước khi có bất kỳ xác nhận nào; đẩy chỉ là tối ưu độ trễ, cursor sync là đường bảo đảm.' },
    { t: 'mc', q: 'Chọn partition key cho bảng messages là gì và vì sao?', o: ['user_id vì mỗi người đọc tin của mình', 'message_id để phân bố đều', 'channel_id vì mọi truy vấn đều là lấy tin của một hội thoại theo thứ tự', 'created_at theo ngày'], a: 2, why: 'Truy vấn duy nhất là theo hội thoại; partition theo channel_id với clustering message_id trả về một lần đọc tuần tự.' },
    { t: 'mc', q: 'Chat service biết người nhận đang nối vào gateway nào bằng cách nào?', o: ['Broadcast tới mọi gateway', 'Registry trong Redis ánh xạ (user, device) → gateway với TTL heartbeat', 'Hỏi load balancer', 'Lưu trong bảng messages'], a: 1, why: 'Registry O(1) và chính xác; pub/sub broadcast là phương án dự phòng khi registry lỗi.' },
    { t: 'mc', q: 'Vì sao nên debounce trạng thái offline khoảng 30 giây?', o: ['Để tiết kiệm Redis', 'Vì luật yêu cầu', 'Để giảm số tin nhắn', 'Vì mạng di động chập chờn khiến kết nối rớt và nối lại liên tục, báo ngay sẽ nhấp nháy và tạo bão sự kiện presence'], a: 3, why: 'Presence là eventual; chờ TTL heartbeat tránh fan-out hàng trăm nghìn sự kiện vô ích.' },
    { t: 'mc', q: 'Với multi-device, cursor delivered nên lưu theo gì và read receipt theo gì?', o: ['Cursor theo thiết bị, read receipt theo user', 'Cả hai theo user', 'Cả hai theo thiết bị', 'Cursor theo channel, receipt theo thiết bị'], a: 0, why: 'Mỗi thiết bị nhận tin độc lập nên cần cursor riêng; đã đọc ở một thiết bị nghĩa là user đã đọc.' },
    { t: 'fill', q: 'Điền: client gửi kèm ___ để server nhận ra tin gửi lại sau khi mất kết nối và không lưu trùng.', a: ['client_msg_id', 'client msg id', 'client message id', 'idempotency key'], why: 'Server giữ (sender, client_msg_id) trong 24 h để dedup.' },
    { t: 'fill', q: 'Điền: trong mã hoá đầu cuối cho nhóm, người gửi dùng ___ key để không phải mã hoá tin 500 lần cho từng thành viên.', a: ['sender', 'sender key'], why: 'Sender key phân phối một lần cho thành viên; tin nhóm mã hoá một lần.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Một gateway giữ 300 000 kết nối bị crash. Chuyện gì xảy ra với tin đang gửi và anh hạn chế thiệt hại thế nào?" Trả lời 3–5 câu.', a: 'Tin đã được ghi vào message store trước khi đẩy nên không mất; tin đang đẩy tới gateway đó không được ack delivered, người gửi vẫn thấy sent. Client phát hiện mất kết nối và reconnect với backoff có jitter để 300k client không dồn về cùng một giây; LB loại node chết khỏi pool. Khi nối lại, client gửi cursor last_message_id và nhận các tin bị lỡ, registry được cập nhật gateway mới. Để giảm thiệt hại, gateway stateless và drain từ từ khi deploy, giới hạn số kết nối mỗi node.', keys: ['store', 'reconnect', 'jitter', 'cursor', 'registry'] }
  ]
},
{ id: 'C8', type: 'case', topic: 'search', title: 'Case: Design a search autocomplete (typeahead)', time: '90 phút',
  goal: 'Thiết kế typeahead trả top-k gợi ý trong dưới 100 ms: trie với top-k tính trước, shard theo prefix, pipeline gom log → trie builder → snapshot, cache nhiều tầng, cập nhật offline vs trending realtime, lọc nội dung.',
  md: `
## Đề bài
> "Design the search autocomplete feature: as the user types, show the top five most popular queries starting with what they have typed so far. It must feel instant."

Dịch: thiết kế tính năng gợi ý tìm kiếm; khi user gõ, hiện 5 truy vấn phổ biến nhất bắt đầu bằng chuỗi đã gõ; phải cảm giác tức thì. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Khớp prefix hay cả giữa chuỗi, có sửa lỗi chính tả? → Đáp: prefix là đủ; không sửa chính tả.
- Hỏi: Bao nhiêu gợi ý, xếp theo gì? → Đáp: 5, theo tần suất tìm kiếm lịch sử.
- Hỏi: Cá nhân hoá không? → Đáp: không trong phiên bản này.
- Hỏi: Dữ liệu cập nhật nhanh cỡ nào? → Đáp: hằng ngày là đủ; trending realtime là điểm cộng.
- Hỏi: Quy mô? → Đáp: 10M DAU, mỗi người 10 lần tìm/ngày, 20 ký tự trung bình.
- Hỏi: Ngôn ngữ, chữ hoa thường, ký tự đặc biệt? → Đáp: chuyển về chữ thường, tiếng Anh trước.
- Hỏi: Lọc nội dung nhạy cảm? → Đáp: có, danh sách cấm.

Chốt lại:
**Functional**: GET gợi ý theo prefix, trả 5 kết quả theo độ phổ biến; cập nhật dữ liệu hằng ngày; lọc từ cấm; cho phép thêm trending gần thời gian thực.
**Non-functional**: p99 dưới 100 ms end-to-end (server dưới 20 ms); sẵn sàng cao nhưng không cần strong consistency; chịu 100k+ QPS đỉnh; dữ liệu gợi ý có thể lệch 1 ngày.
**Ngoài phạm vi**: cá nhân hoá, đa ngôn ngữ, fuzzy match, search thật sự.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Request gợi ý | 10M × 10 lần × 20 ký tự (1 request mỗi ký tự) | 2 tỷ/ngày ≈ 24k QPS, đỉnh ×5 ≈ 120k QPS |
| Giảm bằng debounce 100 ms phía client | bỏ ~50% ký tự gõ nhanh | ≈ 60k QPS đỉnh |
| Log truy vấn | 10M × 10 = 100M truy vấn/ngày, 20% là mới | 20M truy vấn khác nhau/ngày × 30 B ≈ 600 MB/ngày |
| Tập truy vấn tích luỹ | 100M–500M truy vấn khác nhau | trie với top-5 tính trước mỗi node: ≈ 10–30 GB |
| Phân bố prefix | 5 ký tự đầu bao phủ ~95% request | chỉ cần tính và cache top-5 cho prefix dài tới 5–6, phần còn lại tìm trong trie |
| Bộ nhớ cache Redis cho prefix ≤ 5 | 26^5 ≈ 12M prefix có nghĩa thực tế vài triệu × 100 B | ≈ 1 GB |

Rút ra: **đọc cực nhiều, ghi theo lô**, dữ liệu vừa RAM → tách hẳn **đường đọc** (trie snapshot trong bộ nhớ) khỏi **đường ghi** (pipeline gom log offline).

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Browser debounce 100 ms] -> CDN[CDN cache 1 giờ] : GET /suggest?q=
CDN -> LB[Load balancer]
LB -> QSvc[Query service]
QSvc -> Cache[Redis prefix to top5]
QSvc -> Trie[Trie servers shard theo prefix]
Trie -> Snap[Snapshot store S3] : nạp khi khởi động
Client -> LogSvc[Search log service] : khi user submit search
LogSvc -> Kafka[Kafka search_logs]
Kafka -> Agg[Aggregator theo giờ Spark/Flink]
Agg -> Builder[Trie builder hằng ngày]
Builder -> Snap
Agg -> Trend[Trending service cửa sổ 1 giờ]
QSvc -> Trend
:::

**Đường đọc**: client debounce → GET /suggest?q=ph → CDN (cache ngắn theo URL) → Query service → Redis GET prefix:ph → miss thì gọi Trie server phụ trách shard của "ph" → trả top-5 → ghi cache → trả JSON nhỏ (dưới 1 KB).
**Đường ghi**: user bấm search (không phải mỗi ký tự) → log (query, ts) vào Kafka → aggregator đếm theo giờ và theo ngày với decay (truy vấn cũ giảm trọng số) → trie builder xây trie mới với top-5 tại mỗi node → ghi snapshot lên S3 → trie server nạp snapshot mới theo kiểu double buffer, không gián đoạn.
**Trending**: aggregator cửa sổ trượt 1 giờ đếm truy vấn tăng đột biến → Trending service giữ danh sách nhỏ → Query service trộn 1–2 gợi ý trending vào kết quả nếu khớp prefix.

API chính:
| Method | Path | Mô tả |
|---|---|---|
| GET | /v1/suggest?q=prefix&limit=5 | trả danh sách gợi ý; Cache-Control 1 giờ |
| POST | /v1/search-log | body query, ts; gọi khi user submit |
| POST | /admin/blocklist | thêm từ cấm, áp dụng ở builder và filter lúc đọc |
| GET | /internal/trie/{prefix} | nội bộ, Query service gọi trie server |

Mô hình dữ liệu:
| Cấu trúc | Khoá | Nội dung |
|---|---|---|
| Trie node | đường đi ký tự | children, top5 [(query, score)] tính trước |
| Redis prefix cache | prefix:{p} | JSON top5, TTL 1 giờ |
| Bảng tần suất (OLAP) | (query, day) | count, decayed_score |
| Snapshot | s3://suggest/trie/{date}/shard-{n} | file nhị phân, kèm manifest version |

## 4. Đào sâu (15–18 phút)
### 4.1 Trie và top-k: tính lúc truy vấn hay tính trước
| Phương án | Chi phí truy vấn | Chi phí bộ nhớ và build | Chọn |
|---|---|---|---|
| Đi tới node prefix rồi duyệt toàn bộ cây con, lấy top-5 | O(p + n log n) với n có thể hàng triệu cho prefix ngắn | Nhỏ | Không, prefix 1–2 ký tự quá chậm |
| Lưu top-5 tại mỗi node, cập nhật khi build | O(p), vài micro giây | Mỗi node thêm 5 con trỏ; build O(tổng độ dài) với truyền ngược từ lá | **Chọn**: đọc là ưu tiên |
| Giới hạn độ dài prefix lưu top-5 tới 6, dài hơn thì duyệt | O(p) đa số, duyệt cho prefix dài (cây con nhỏ) | Giảm bộ nhớ đáng kể | Kết hợp với phương án trên |
Thực hiện: bỏ dấu, chữ thường, cắt độ dài truy vấn 50 ký tự; score có decay theo tuần để truy vấn cũ tự chìm.

### 4.2 Shard trie theo prefix
- Chia theo ký tự đầu: 26 shard nhưng lệch (s, c, p nhiều hơn x, z nhiều lần). Chia theo 2 ký tự đầu thì 676 nhóm nhỏ, gom lại thành shard cân bằng theo kích thước thực tế.
- **Shard map manager**: bảng ánh xạ prefix range → shard (ví dụ a–ag → shard 1, ah–az → shard 2) tính từ dữ liệu, lưu ở config service; Query service đọc map từ cache. Khi dữ liệu đổi, builder tạo map mới cùng snapshot.
- Mỗi shard chạy 3 replica để chịu tải và chịu lỗi; replica đọc cùng snapshot nên nhất quán.

### 4.3 Cập nhật: offline hằng ngày hay realtime
| Phương án | Ưu | Nhược |
|---|---|---|
| Rebuild toàn bộ hằng ngày từ bảng tần suất (chọn làm nền) | Đơn giản, snapshot bất biến, rollback dễ, không có ghi trên đường đọc | Trễ tới 24 giờ |
| Cập nhật trie tại chỗ theo từng truy vấn | Realtime | Khoá ghi trên cấu trúc đang đọc, top-5 phải tính lại dọc đường đi, dễ lỗi |
| Hybrid: snapshot hằng ngày + lớp trending nhỏ cửa sổ 1 giờ (chọn) | Realtime cho cái cần, đọc vẫn không khoá | Hai nguồn phải merge và lọc trùng |
Trie server nạp snapshot mới vào bộ nhớ thứ hai rồi đổi con trỏ (double buffer); cần RAM gấp đôi trong lúc nạp, chấp nhận.

### 4.4 Cache nhiều tầng và lọc
- Browser: debounce 100 ms, cache kết quả theo prefix trong phiên (gõ lùi không gọi lại).
- CDN: GET theo URL với Cache-Control 1 giờ; 5 ký tự đầu chiếm 95% request và có số lượng hữu hạn nên hit rất cao; đổi dữ liệu thì chỉ cần chờ TTL vì gợi ý lệch 1 giờ không sao.
- Redis: tầng giữa cho prefix dài hơn hoặc khi CDN miss.
- Lọc: builder loại truy vấn trong blocklist khi xây; Query service lọc lần nữa lúc đọc để blocklist mới có hiệu lực ngay (cache phải xoá theo prefix liên quan hoặc chờ TTL).

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Vì sao không dùng Elasticsearch completion suggester?" → Hoàn toàn được cho quy mô vừa (FST trong RAM, hỗ trợ weight); tự xây trie khi cần kiểm soát bộ nhớ, shard theo prefix và pipeline riêng; nói được cả hai.
2. "Prefix 1 ký tự thì top-5 lấy đâu?" → Tính trước tại node, không duyệt; thậm chí cache cứng ở CDN.
3. "Tiếng Việt có dấu, tiếng Nhật?" → Chuẩn hoá Unicode NFC, với tiếng Nhật cần xử lý theo kana và romaji; cây theo code point thay vì byte; ngoài phạm vi nhưng nêu được.
4. "Gợi ý cá nhân hoá?" → Thêm lớp re-rank nhỏ theo lịch sử user ở Query service trên top-20 thay vì top-5; cache CDN mất tác dụng cho phần cá nhân hoá.
5. "Snapshot 20 GB nạp mất bao lâu?" → Đọc từ S3 vài trăm MB/s → 1–2 phút; nạp song song theo shard; không ảnh hưởng đọc vì double buffer.
6. "Một truy vấn bị spam để lên top?" → Đếm theo user hoặc session khác nhau thay vì số lần thô; giới hạn đóng góp mỗi user mỗi ngày; lọc bot.
7. "Trie server chết?" → 3 replica mỗi shard, Query service retry replica khác; cache Redis và CDN che phần lớn.
8. "Đo chất lượng gợi ý?" → Tỉ lệ user chọn gợi ý (click-through), vị trí được chọn, tỉ lệ bỏ gõ tiếp.

### Sai lầm hay gặp
- Gọi DB với LIKE prefix% mỗi ký tự gõ.
- Trie không lưu top-k, duyệt cây con cho prefix ngắn.
- Cập nhật trie tại chỗ trên đường đọc.
- Quên debounce và cache phía client, ước lượng QPS gấp đôi thực tế.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Cấu trúc dữ liệu | "Dùng DB index" | Trie top-k tính trước, O(p), giới hạn độ sâu |
| Tách đọc ghi | Ghi trực tiếp | Pipeline log → aggregate → build → snapshot, double buffer |
| Scale đọc | Một server | Shard map theo prefix, replica, cache 3 tầng, 95% ở 5 ký tự |
| Realtime | Không có hoặc làm hỏng đường đọc | Lớp trending nhỏ trộn lúc đọc |
| Chất lượng | Không nói | Decay, chống spam, blocklist hai lớp, metric click-through |

### Nói thế nào trong phỏng vấn (EN)
- "Every keystroke is a read, so I precompute the top five at each trie node and make lookups O(length of prefix)." — Tính trước top-5 tại node.
- "The write path is completely offline: aggregate logs, rebuild the trie, publish an immutable snapshot, and hot swap it." — Đường ghi offline, snapshot bất biến, hot swap.
- "Since the first five characters cover about ninety-five percent of requests, CDN and Redis absorb most of the load." — 5 ký tự đầu bao phủ 95%, cache chịu phần lớn.
- "I shard by prefix ranges using a shard map built from actual data rather than one shard per letter." — Shard theo range prefix dựa dữ liệu thực.
- "Trending is a small separate layer merged at read time so the main trie never takes writes." — Trending là lớp riêng, trie chính không nhận ghi.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- FE của bạn có ô tìm component theo tên, purl, CVE id, license id trên tenant có hàng trăm nghìn component; nếu đang LIKE prefix% trên Postgres mỗi lần gõ thì đây là bài cần áp dụng ngay. Elasticsearch đã có trong stack: dùng completion suggester (FST trong RAM) với weight = số lần xuất hiện trong tenant, index theo tenant để không lọt dữ liệu chéo (nhớ sự cố leak cross-tenant).
- Danh sách license SPDX (~600 id) và CVE id có cấu trúc đều: cache trong RAM apiserver dạng sorted slice + binary search theo prefix là đủ, không cần ES; đổi mới khi bảng thay đổi.
- Pipeline đường ghi offline giống enrichment của bạn: log → aggregate → build snapshot → hot swap. Áp dụng tư duy snapshot bất biến cho t_project_metrics: build xong rồi đổi con trỏ, không cập nhật tại chỗ, dễ rollback khi reconcile sai (sự cố wipe violation).
- Debounce 100 ms và cache theo prefix ở FE Next.js giảm ngay một nửa request mà không đụng backend.
- Việc tuần này: bật pg_stat_statements lọc truy vấn có LIKE hoặc ILIKE với tham số prefix, đo p95; nếu quá 100 ms, prototype completion suggester trên ES cho field component_name theo tenant.
- Lọc hai lớp (lúc build và lúc đọc) tương ứng với policy blocklist license: áp dụng cả khi import và khi hiển thị để rule mới có hiệu lực ngay.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao lưu top-5 tại mỗi node của trie thay vì duyệt cây con lúc truy vấn?', o: ['Để tiết kiệm bộ nhớ', 'Vì duyệt cây con của prefix ngắn như "a" chạm hàng triệu node, không thể đạt dưới 20 ms', 'Vì trie không duyệt được', 'Để không cần shard'], a: 1, why: 'Tính trước đổi bộ nhớ lấy thời gian: truy vấn O(độ dài prefix) bất kể cây con lớn tới đâu.' },
    { t: 'mc', q: 'Cách cập nhật dữ liệu gợi ý được chọn làm nền là gì?', o: ['Cập nhật trie tại chỗ sau mỗi truy vấn', 'Ghi thẳng vào Redis mỗi lần user tìm', 'Rebuild trie offline hằng ngày thành snapshot bất biến rồi hot swap, cộng lớp trending nhỏ riêng', 'Dùng DB index và LIKE'], a: 2, why: 'Đường đọc không bao giờ nhận ghi hay khoá; snapshot dễ rollback; trending xử lý phần cần realtime.' },
    { t: 'mc', q: 'Vì sao chia shard theo một ký tự đầu (26 shard) là chưa đủ tốt?', o: ['Vì 26 quá nhiều shard', 'Vì phân bố truy vấn theo chữ cái rất lệch, cần shard map theo range prefix dựa dữ liệu thực', 'Vì chữ cái không hash được', 'Vì CDN không hỗ trợ'], a: 1, why: 'Chữ s, c, p nhiều gấp nhiều lần x, z; shard map cân bằng theo kích thước thực tế.' },
    { t: 'mc', q: 'Yếu tố nào cho phép CDN và Redis hấp thụ phần lớn tải typeahead?', o: ['Prefix 5 ký tự đầu chiếm khoảng 95% request và có số lượng hữu hạn, kết quả chấp nhận lệch 1 giờ', 'Request có body lớn', 'Người dùng ít gõ', 'Trie rất nhỏ'], a: 0, why: 'Không gian prefix ngắn nhỏ và lặp lại nhiều → hit ratio rất cao với TTL ngắn.' },
    { t: 'mc', q: 'Việc nào nên ghi log để tính độ phổ biến?', o: ['Mỗi ký tự user gõ', 'Mỗi lần user submit tìm kiếm thật sự', 'Mỗi lần CDN miss', 'Mỗi lần trie server khởi động'], a: 1, why: 'Đếm theo ký tự gõ làm méo tần suất và gấp 20 lần dữ liệu; submit mới phản ánh ý định.' },
    { t: 'fill', q: 'Điền: trie server nạp snapshot mới vào vùng nhớ thứ hai rồi đổi con trỏ, kỹ thuật này gọi là ___ buffer.', a: ['double', 'double buffer', 'double buffering'], why: 'Đọc không gián đoạn, trả giá bằng RAM gấp đôi trong lúc nạp.' },
    { t: 'fill', q: 'Điền: để truy vấn cũ tự chìm theo thời gian, score được áp dụng ___ theo tuần khi aggregate.', a: ['decay', 'suy giảm', 'time decay'], why: 'Decay giữ gợi ý tươi mà không cần xoá dữ liệu lịch sử.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Một sự kiện lớn vừa xảy ra, mọi người tìm một cụm từ mới. Snapshot của anh chỉ rebuild mỗi ngày. Làm sao gợi ý kịp?" Trả lời 3–5 câu.', a: 'Tôi không đụng vào trie chính mà thêm lớp trending: aggregator cửa sổ trượt 1 giờ trên Kafka phát hiện truy vấn tăng đột biến so với nền, đẩy danh sách nhỏ vài nghìn cụm từ kèm score vào Trending service trong Redis. Query service khi trả kết quả sẽ merge top-5 từ trie với 1–2 gợi ý trending khớp prefix, loại trùng. Cache CDN và Redis cho các prefix liên quan dùng TTL ngắn hơn hoặc được xoá chủ động. Hôm sau rebuild hằng ngày sẽ đưa cụm từ đó vào trie chính một cách tự nhiên.', keys: ['trending', 'cửa sổ', 'merge', 'cache', 'rebuild'] }
  ]
},
{ id: 'C9', type: 'case', topic: 'storage', title: 'Case: Design a video streaming platform (YouTube)', time: '120 phút',
  goal: 'Thiết kế upload presigned và resumable, pipeline transcoding dạng DAG song song theo độ phân giải, adaptive bitrate với HLS/DASH qua CDN, metadata DB, view count bất đồng bộ, và lập luận chi phí CDN vs storage.',
  md: `
## Đề bài
> "Design a video sharing platform like YouTube: users upload videos, we process them, and viewers stream them smoothly on any device and network. Assume five million daily active users."

Dịch: thiết kế nền tảng chia sẻ video kiểu YouTube; user upload, hệ thống xử lý, người xem stream mượt trên mọi thiết bị và mạng; 5 triệu DAU. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Tính năng cốt lõi? → Đáp: upload, xem, tìm theo tiêu đề cơ bản, like và view count.
- Hỏi: Kích thước và độ dài video? → Đáp: tối đa 1 GB, trung bình 300 MB, dài 10 phút.
- Hỏi: Tỉ lệ upload và xem? → Đáp: 10% DAU upload 1 video/ngày; mỗi DAU xem 5 video/ngày.
- Hỏi: Live stream? → Đáp: không, chỉ video on demand.
- Hỏi: Thiết bị và mạng? → Đáp: mobile 3G tới desktop fiber → cần adaptive bitrate.
- Hỏi: Có cần DRM, kiểm duyệt? → Đáp: ngoài phạm vi, nhưng chừa chỗ trong pipeline.
- Hỏi: Chi phí có là ràng buộc không? → Đáp: có, CDN và storage là hai khoản lớn nhất.

Chốt lại:
**Functional**: upload (resumable), xử lý ra nhiều độ phân giải, stream adaptive, metadata (tiêu đề, mô tả, thumbnail), view count, like.
**Non-functional**: video sẵn sàng xem trong vài phút sau upload; start-up time dưới 2 s; không mất video đã upload; 5M DAU; chi phí CDN và storage kiểm soát được; sẵn sàng 99,9% cho xem.
**Ngoài phạm vi**: live, DRM, recommendation, comment, kiểm duyệt nội dung.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Upload | 5M × 10% | 500k video/ngày ≈ 6 video/s |
| Dữ liệu upload | 500k × 300 MB | 150 TB/ngày, băng thông vào ≈ 1,7 GB/s |
| Storage sau transcoding | gốc + 5 độ phân giải ≈ ×1,5 | 225 TB/ngày ≈ 80 PB/năm → phải phân tầng và nghĩ về giữ bản gốc |
| Xem | 5M × 5 | 25M lượt/ngày ≈ 300 lượt/s, đỉnh ≈ 1 000/s |
| Băng thông ra | 25M × 10 phút × 1,5 Mbps trung bình ≈ 25M × 110 MB | ≈ 2,75 PB/ngày ≈ 250 Gbps trung bình, đỉnh 750 Gbps → chỉ CDN chịu được |
| Chi phí CDN thô | 2,75 PB = 2,75 triệu GB × ~0,02 USD/GB (bậc giá niêm yết CloudFront trên 5 PB/tháng) | ≈ 55 000 USD/ngày, lớn hơn storage nhiều lần |
| Transcoding | 500k × 10 phút × 5 độ phân giải, ~1× realtime mỗi output | ≈ 25M phút CPU/ngày ≈ 17 000 core chạy liên tục → cần song song và hàng đợi |

Rút ra: **egress CDN** và **CPU transcoding** là hai bài toán chi phí; storage lớn nhưng rẻ hơn. Kiến trúc phải song song hoá transcoding và tối ưu cache CDN.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Up[Uploader] -> API[Upload API] : xin presigned URL
Up -> S3Raw[Object storage raw] : multipart upload trực tiếp
S3Raw -> MQ[Queue video_uploaded] : event
MQ -> Orch[Transcoding orchestrator DAG]
Orch -> Workers[Transcode workers per resolution]
Workers -> S3Out[Object storage HLS segments]
Orch -> Meta[Metadata DB Postgres]
Viewer[Viewer] -> Play[Playback API] : lấy manifest URL
Play -> Meta
Viewer -> CDN[CDN] : segments
CDN -> S3Out : origin
Viewer -> Kafka[Kafka view events]
Kafka -> Count[Counter aggregator]
Count -> Meta
:::

**Luồng upload**: client POST /videos với metadata → API tạo video_id trạng thái uploading, trả presigned multipart URL → client upload từng part 10 MB thẳng lên object storage (resumable: hỏi API part nào đã xong) → client gọi complete → storage phát event → orchestrator tạo DAG job.
**Luồng xử lý**: inspect (codec, độ dài, kiểm tra hợp lệ) → split thành chunk 10 s theo keyframe → song song encode mỗi chunk × mỗi độ phân giải (1080p, 720p, 480p, 360p, 240p) → thumbnail, audio riêng → package HLS/DASH (segment + playlist) → ghi S3Out → cập nhật Metadata trạng thái ready và danh sách rendition → thông báo uploader.
**Luồng xem**: GET /videos/{id} → metadata + URL manifest trên CDN → player tải master playlist → chọn rendition theo băng thông → tải segment từ CDN (miss thì origin S3) → player gửi view event theo lô.

API chính:
| Method | Path | Mô tả |
|---|---|---|
| POST | /v1/videos | metadata → video_id, upload_id, presigned part URLs |
| GET | /v1/videos/{id}/upload-status | part đã nhận, để resume |
| POST | /v1/videos/{id}/complete | kết thúc multipart, kích hoạt xử lý |
| GET | /v1/videos/{id} | metadata, trạng thái, manifest URL |
| POST | /v1/videos/{id}/view | event xem theo lô, bất đồng bộ |
| GET | /v1/search?q= | tìm theo tiêu đề qua Elasticsearch |

Mô hình dữ liệu:
| Bảng | Khoá | Cột chính |
|---|---|---|
| videos | video_id | owner_id, title, status (uploading, processing, ready, failed), duration, content_hash, created_at |
| renditions | (video_id, resolution) | bitrate, manifest_path, segment_count, size_bytes |
| transcode_jobs | job_id | video_id, dag_state JSON, attempts, started_at, finished_at |
| video_stats | video_id | view_count, like_count, updated_at (ghi theo lô) |
| upload_sessions | upload_id | video_id, parts_received bitmap, expires_at |

## 4. Đào sâu (15–18 phút)
### 4.1 Transcoding pipeline dạng DAG
| Phương án | Ưu | Nhược |
|---|---|---|
| Một worker xử lý tuần tự cả video | Đơn giản | Video 1 giờ mất hàng giờ; một lỗi mất hết; không tận dụng CPU song song |
| Song song theo độ phân giải (5 task) | Nhanh ×5, cô lập lỗi theo rendition | Video dài vẫn chậm |
| Song song theo chunk × độ phân giải (chọn) | Video 10 phút thành 60 chunk × 5 = 300 task nhỏ 10–30 s, xử lý trong 1–2 phút; task nhỏ dễ retry, dễ dùng spot instance | Cần bước split theo keyframe và merge; orchestrator phức tạp hơn |
Thiết kế orchestrator: DAG lưu trong DB (task, phụ thuộc, trạng thái); mỗi task idempotent (output ghi theo đường dẫn xác định, chạy lại ghi đè); retry 3 lần với backoff rồi đánh dấu fail cho **đúng task đó**, không fail cả video; rendition thấp xong trước thì cho phép xem sớm ở 360p trong khi 1080p còn chạy. Hàng đợi task có ưu tiên: video ngắn và kênh lớn trước.

### 4.2 Adaptive bitrate: HLS/DASH
- Mỗi rendition cắt thành segment 2–6 s (fMP4 hoặc TS), có playlist riêng; master playlist liệt kê rendition kèm bitrate và độ phân giải. Player đo throughput và buffer để đổi rendition giữa chừng mà không dừng.
- Segment ngắn → đổi chất lượng nhanh, start-up nhanh, nhưng nhiều request và playlist dài; 4 s là cân bằng phổ biến.
- Codec: H.264 cho tương thích rộng, thêm VP9/AV1 cho video phổ biến để giảm 30–50% băng thông (đổi CPU encode lấy egress, chỉ đáng với video có nhiều view).

### 4.3 Chi phí: CDN vs storage vs compute
| Khoản | Đặc tính | Chiến lược |
|---|---|---|
| CDN egress | Lớn nhất, tỉ lệ số lượt xem | Cache hit cao bằng segment bất biến và URL ổn định; video ít xem phục vụ từ origin qua CDN pass-through để không tốn cache; đàm phán theo volume |
| Storage | 80 PB/năm, tăng tuyến tính | Phân tầng: hot (30 ngày) → warm → cold cho video không xem 1 năm; xoá bản gốc sau khi có rendition cao nhất nếu chính sách cho phép, hoặc lưu bản gốc ở cold |
| Compute transcoding | Theo số upload | Spot instance cho task nhỏ idempotent; encode rendition cao chỉ khi video có view (lazy transcoding cho long tail) |
Phân phối lượt xem rất lệch: 5% video chiếm phần lớn lượt xem → chỉ cần CDN thực sự nóng cho 5% này.

### 4.4 Upload lớn, dedup, view count
- **Resumable**: multipart upload, part 10 MB, client giữ upload_id và hỏi part đã nhận; hết hạn 24 h thì dọn. Băng thông vào đi thẳng object storage, API không chạm byte nào.
- **Dedup**: hash nội dung (SHA-256 toàn file, tính phía client hoặc ở bước inspect) → nếu trùng content_hash đã ready, trỏ renditions dùng chung, bỏ transcoding; dedup theo nội dung thị giác (perceptual hash) là bài nâng cao.
- **View count**: player gửi event theo lô → Kafka → aggregator đếm theo phút → cập nhật video_stats theo lô; chống gian lận bằng dedup theo (user hoặc thiết bị, video, ngày) và tối thiểu 30 s xem. Hiển thị số gần đúng, chấp nhận trễ vài phút; đây là nơi không nên dùng strong consistency.

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Vì sao upload thẳng lên S3 mà không qua API?" → 150 TB/ngày qua API là lãng phí và là điểm nghẽn; presigned URL cho phép S3 nhận trực tiếp, API chỉ cấp quyền và theo dõi.
2. "Một chunk encode lỗi mãi?" → Fail đúng task, giữ rendition khác; thử encoder preset khác; nếu vẫn lỗi thì video ready với rendition thiếu và báo cho owner; không chặn cả pipeline.
3. "Người xem ở Nhật, origin ở Mỹ?" → CDN edge gần người xem; miss đầu tiên tốn 150 ms liên lục địa cho segment đầu; prefetch segment kế tiếp; nhiều origin theo khu vực cho video nóng.
4. "Chống hotlink hoặc xem lậu?" → Signed URL cho manifest và segment với TTL; token theo user; DRM nếu cần (ngoài phạm vi).
5. "Video 4 giờ thì DAG bao nhiêu task?" → 1 440 chunk × 5 = 7 200 task; giới hạn song song mỗi video để không chiếm hết hàng đợi của người khác (fair share).
6. "Metadata DB chịu 1 000 QPS đỉnh được không?" → Dư sức với Postgres + cache Redis cho metadata video nóng; thực tế đọc metadata ít hơn đọc segment hàng trăm lần.
7. "Thumbnail và preview?" → Task riêng trong DAG, sinh 3 ảnh tại các mốc, lưu CDN; sprite sheet cho preview khi rê chuột.
8. "Đo gì?" → Thời gian từ complete upload tới ready (p50, p95), tỉ lệ task fail, CDN hit ratio, start-up time, rebuffer ratio, chi phí egress mỗi 1 000 lượt xem.

### Sai lầm hay gặp
- Upload qua API server rồi API đẩy lên S3.
- Transcoding tuần tự một task mỗi video.
- Trả file MP4 nguyên khối, không adaptive, không CDN.
- Cập nhật view_count bằng UPDATE mỗi lượt xem trên bảng videos.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Upload | Qua API | Presigned multipart, resumable, event-driven |
| Xử lý | Một worker | DAG chunk × rendition, task idempotent, fail cục bộ, ưu tiên |
| Phân phối | "Dùng CDN" | HLS/DASH segment, master playlist, codec trade-off, signed URL |
| Chi phí | Không nhắc | Egress là khoản lớn nhất, phân tầng storage, lazy transcoding, spot |
| Dữ liệu phụ | Ghi đồng bộ | View count theo lô qua Kafka, dedup, chống gian lận |

### Nói thế nào trong phỏng vấn (EN)
- "Clients upload straight to object storage with presigned multipart URLs; the API never touches the bytes." — Upload thẳng lên object storage.
- "Transcoding is a DAG of small idempotent tasks, one per chunk per resolution, so a ten minute video finishes in about two minutes and a failed chunk only retries itself." — DAG task nhỏ idempotent.
- "I package HLS with four second segments so the player can switch bitrate without stalling." — HLS segment 4 s cho adaptive.
- "Egress is the dominant cost, so I focus on CDN hit ratio and tiered storage for the long tail." — Egress là chi phí lớn nhất.
- "View counts are aggregated from Kafka in batches; nobody needs them to be exact in real time." — View count gộp theo lô.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Pipeline enrichment của bạn là một DAG: parse SBOM → tách component → license theo batch ClearlyDefined → vulnerability theo từng nguồn (OSV, NVD, GHSA, EUVD, JVNDB) song song → policy evaluation → notification. Hiện nó chạy như "một worker tuần tự" với bước lỗi làm hỏng toàn bộ: một coordinate version-range làm hỏng cả batch, FetchBatch nuốt lỗi, hàng nghìn dòng enrichment_failed vĩnh viễn. Áp dụng mục 4.1: task nhỏ idempotent, fail đúng task, retry riêng, trạng thái DAG lưu DB thay vì trong RAM Lambda.
- Lambda chain upload 15 phút one-shot không retry làm thiếu snapshot t_project_metrics (distribution biến mất): tương ứng với "transcoding tuần tự một task", cần orchestrator biết task nào chưa xong và chạy bù.
- Upload SBOM 200k component (5 file stress test gây backlog 696k) nên đi presigned URL lên MinIO/S3 rồi event kích hoạt parse, thay vì POST multipart qua apiserver và parse trong request; thêm giới hạn kích thước và hàng đợi có ưu tiên theo tenant (fair share) để một tenant không chiếm hết worker.
- Dedup theo content hash: re-import cùng file SBOM gây drift license (inline vs sweeper heal); hash file và hash identity component giúp nhận ra "cùng nội dung" và bỏ qua xử lý lại.
- Phân tầng storage: file SBOM gốc và revision cũ ít khi đọc lại → chuyển sang tầng lạnh của S3 sau 90 ngày, giữ metadata trong Postgres.
- Việc tuần này: vẽ DAG enrichment hiện tại với trạng thái lưu ở đâu cho từng bước; chỉ ra bước nào không idempotent; viết ADR "mỗi bước enrichment là task có trạng thái trong DB, retry riêng, không nuốt lỗi batch".
- Metric cần có: thời gian từ upload tới ready theo p50 và p95 cho mỗi tenant, giống "upload tới ready" của video.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao client nên upload video thẳng lên object storage bằng presigned URL?', o: ['Để mã hoá tốt hơn', 'Vì API không hỗ trợ file lớn', 'Để băng thông 150 TB/ngày không đi qua API server và API chỉ làm việc cấp quyền, theo dõi', 'Để không cần transcoding'], a: 2, why: 'API chạm từng byte là điểm nghẽn và lãng phí; object storage sinh ra để nhận dữ liệu lớn trực tiếp.' },
    { t: 'mc', q: 'Lợi ích chính của chia transcoding thành task theo chunk × độ phân giải là gì?', o: ['Giảm dung lượng video', 'Thời gian xử lý giảm nhiều lần, task nhỏ dễ retry và chỉ chunk lỗi mới chạy lại', 'Không cần orchestrator', 'Không cần object storage'], a: 1, why: 'Hàng trăm task 10–30 giây chạy song song và cô lập lỗi; trade-off là cần split và merge.' },
    { t: 'mc', q: 'Khoản chi phí lớn nhất của nền tảng video on demand thường là gì?', o: ['CDN egress', 'Metadata DB', 'Thumbnail', 'API server'], a: 0, why: '2,75 PB/ngày egress ở vài cent mỗi GB vượt xa storage và compute.' },
    { t: 'mc', q: 'Adaptive bitrate với HLS hoạt động nhờ điều gì?', o: ['Server đổi codec theo yêu cầu', 'Video cắt thành segment ngắn ở nhiều rendition và player tự chọn rendition theo băng thông đo được', 'CDN nén video khi gửi', 'Player tải cả file trước'], a: 1, why: 'Master playlist liệt kê rendition; player đổi rendition ở ranh giới segment không dừng phát.' },
    { t: 'mc', q: 'View count nên được cập nhật thế nào?', o: ['UPDATE videos SET view_count = view_count + 1 mỗi lượt xem', 'Lưu trong cookie người xem', 'Đếm bằng log CDN cuối tháng', 'Event vào Kafka, aggregator gộp theo phút và ghi theo lô, chấp nhận trễ vài phút'], a: 3, why: 'Hàng nghìn UPDATE một dòng mỗi giây gây tranh chấp khoá; số gần đúng là đủ.' },
    { t: 'fill', q: 'Điền: upload file lớn chia thành nhiều part và có thể tiếp tục sau khi đứt mạng gọi là ___ upload.', a: ['resumable', 'multipart', 'resumable multipart'], why: 'Client giữ upload_id và hỏi part đã nhận để gửi tiếp phần còn thiếu.' },
    { t: 'fill', q: 'Điền: mỗi task trong DAG transcoding phải ___ để chạy lại không gây hậu quả phụ (ghi đè cùng đường dẫn output).', a: ['idempotent', 'idempotency', 'luỹ đẳng'], why: 'Retry an toàn chỉ khi kết quả chạy lần 2 giống lần 1.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Một video 10 phút được upload. Mô tả chuyện gì xảy ra từ lúc upload xong tới lúc xem được, và video sẵn sàng sau bao lâu?" Trả lời 4–6 câu.', a: 'Client gọi complete multipart, object storage phát event vào queue, orchestrator tạo DAG: inspect kiểm tra codec và độ dài, split theo keyframe thành khoảng 60 chunk 10 giây. Mỗi chunk sinh 5 task encode cho 5 độ phân giải, tổng khoảng 300 task nhỏ chạy song song trên pool worker, mỗi task 10–30 giây. Khi rendition 360p hoàn tất trước, packager tạo playlist và video có thể xem sớm ở chất lượng thấp; các rendition cao bổ sung vào master playlist khi xong. Metadata DB chuyển trạng thái ready, manifest URL trỏ qua CDN. Với đủ worker, video sẵn sàng trong 1–2 phút; nếu một chunk lỗi, chỉ chunk đó retry.', keys: ['event', 'DAG', 'chunk', 'song song', 'playlist', 'ready'] }
  ]
},
{ id: 'C10', type: 'case', topic: 'storage', title: 'Case: Design a cloud file storage (Google Drive, Dropbox)', time: '120 phút',
  goal: 'Thiết kế đồng bộ file: chunking block-level với dedup và delta sync, metadata DB strong consistency, notification service cho sync, conflict resolution, offline queue, cold storage và chia sẻ quyền.',
  md: `
## Đề bài
> "Design a cloud file storage and sync service like Dropbox or Google Drive: users upload files from any device, files sync across their devices, they can share files with others, and we keep version history."

Dịch: thiết kế dịch vụ lưu trữ và đồng bộ file kiểu Dropbox; upload từ mọi thiết bị; đồng bộ giữa các thiết bị; chia sẻ; giữ lịch sử phiên bản. Thời gian 45 phút.

## 1. Làm rõ yêu cầu (5 phút)
- Hỏi: Kích thước file tối đa, loại file? → Đáp: tới 10 GB, mọi loại; đa số nhỏ hơn 1 MB.
- Hỏi: Quy mô? → Đáp: 50M user đăng ký, 10M DAU, 10 GB miễn phí mỗi người.
- Hỏi: Đồng bộ nhanh cỡ nào? → Đáp: thiết bị khác thấy thay đổi trong vài giây.
- Hỏi: Hai thiết bị sửa cùng file khi offline? → Đáp: không được mất dữ liệu; giải quyết conflict đơn giản là được.
- Hỏi: Lịch sử phiên bản bao lâu? → Đáp: 30 ngày.
- Hỏi: Chia sẻ ở mức file hay thư mục, có link công khai? → Đáp: cả hai; quyền view và edit.
- Hỏi: Mã hoá? → Đáp: at rest và in transit; không end-to-end.

Chốt lại:
**Functional**: upload, download, sửa, xoá, di chuyển; đồng bộ nhiều thiết bị; lịch sử 30 ngày; chia sẻ với quyền; làm việc offline rồi đồng bộ.
**Non-functional**: metadata **strong consistency** (mọi thiết bị thấy cùng cây thư mục); không mất dữ liệu (độ bền 11 số 9 của object storage); đồng bộ trong vài giây; tiết kiệm băng thông (chỉ gửi phần thay đổi); 10M DAU; chi phí storage kiểm soát được.
**Ngoài phạm vi**: chỉnh sửa tài liệu cộng tác realtime, tìm kiếm nội dung, OCR.

## 2. Ước lượng (5 phút)
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Upload | 10M DAU × 2 file/ngày | 20M file/ngày ≈ 230/s, đỉnh ≈ 700/s |
| Dữ liệu mới | 20M × 500 KB trung bình | 10 TB/ngày, băng thông vào ≈ 120 MB/s |
| Storage logic | 50M × 10 GB × 10% dùng thực | 50 PB |
| Storage vật lý | dedup block giảm ~30%, replication do object storage lo | ≈ 35 PB trước erasure coding |
| Metadata | 50M user × 1 000 file × 500 B | 25 TB metadata → phải shard Postgres theo user_id |
| Block | 50 PB / 4 MB | 12,5 tỷ block, bảng block index 12,5 tỷ × 100 B ≈ 1,25 TB |
| Notification | 10M DAU, 2 thay đổi/ngày × 3 thiết bị | 60M thông báo/ngày ≈ 700/s, nhưng 10M kết nối chờ |

Rút ra: dữ liệu lớn nhưng object storage lo độ bền; **điểm khó là metadata nhất quán, chunking để tiết kiệm băng thông, và thông báo tới hàng triệu client đang chờ**.

## 3. Thiết kế tổng thể (10–12 phút)
:::diagram
Client[Sync client] -> BlockSvc[Block service] : upload chunk 4 MB
BlockSvc -> S3[Object storage blocks]
Client -> MetaAPI[Metadata API] : commit file version
MetaAPI -> MetaDB[Metadata DB Postgres shard theo user]
MetaAPI -> Cache[Redis metadata cache]
MetaAPI -> MQ[Queue file_changed]
MQ -> Notif[Notification service long poll]
Notif -> Other[Other devices] : có thay đổi
Other -> MetaAPI : lấy delta
Other -> BlockSvc : tải block thiếu
MetaDB -> Cold[Lifecycle sang cold storage]
:::

**Luồng upload hoặc sửa file**: client chia file thành block 4 MB, tính SHA-256 mỗi block → hỏi Metadata API block nào đã có (dedup) → upload block thiếu lên Block service (nén, mã hoá) → gọi commit: tạo version mới gồm danh sách block hash, kích thước, mtime, parent version → Metadata DB ghi trong transaction, tăng version của namespace → publish file_changed → thiết bị khác được báo.
**Luồng sync thiết bị khác**: client giữ long polling tới Notification service; nhận tín hiệu → gọi GET /delta?cursor= → nhận danh sách thay đổi từ cursor → so với trạng thái local → tải block thiếu → ghép file → cập nhật cursor.
**Luồng offline**: client ghi thay đổi vào hàng đợi local; khi online, gửi lần lượt; commit kèm parent_version để server phát hiện conflict.

API chính:
| Method | Path | Mô tả |
|---|---|---|
| POST | /v1/blocks/check | body danh sách hash → hash nào chưa có |
| PUT | /v1/blocks/{hash} | upload block, idempotent theo hash |
| POST | /v1/files/{id}/commit | body block hashes, size, parent_version → version mới hoặc 409 conflict |
| GET | /v1/delta?cursor= | thay đổi của namespace từ cursor |
| GET | /v1/notify/longpoll?cursor= | giữ kết nối tới 60 s, trả khi có thay đổi |
| POST | /v1/shares | chia sẻ file hoặc thư mục với user hoặc link, quyền view/edit |

Mô hình dữ liệu:
| Bảng | Khoá | Cột chính |
|---|---|---|
| namespaces | ns_id | owner_id, current_cursor (tăng dần) |
| files | (ns_id, file_id) | path, current_version, is_deleted, updated_at |
| file_versions | (file_id, version) | block_hashes[], size, mtime, device_id, created_at |
| blocks | hash | size, storage_key, ref_count, storage_tier |
| changes | (ns_id, cursor) | file_id, version, type → nguồn cho /delta |
| shares | (resource_id, grantee) | permission, link_token, expires_at |
| devices | (user_id, device_id) | last_cursor, last_seen |

## 4. Đào sâu (15–18 phút)
### 4.1 Chunking, dedup, delta sync
| Phương án | Ưu | Nhược |
|---|---|---|
| Upload cả file mỗi lần sửa | Đơn giản | Sửa 1 KB trong file 1 GB tốn 1 GB băng thông và storage |
| Block cố định 4 MB + hash (chọn làm nền) | Dedup giữa user và giữa phiên bản; chỉ upload block đổi; resume theo block | Chèn 1 byte đầu file dịch mọi block → mất dedup phần sau |
| Content-defined chunking (Rabin fingerprint) | Chịu được chèn xoá, dedup tốt hơn | Kích thước block biến thiên, CPU client cao hơn |
| Delta nhị phân giữa 2 version (rsync) | Tối ưu băng thông nhất | Server phải tái tạo, không dedup giữa user |
Chọn block cố định 4 MB cho đa số, content-defined cho file lớn hay sửa (log, VM image) nếu có thời gian nói thêm. Dedup theo hash toàn hệ thống: block giống nhau giữa hai user chỉ lưu một lần (ref_count); phải mã hoá bằng khoá hệ thống chứ không theo user, nếu không hash khác nhau và mất dedup.

### 4.2 Metadata DB: strong consistency
- Cây thư mục và version phải nhất quán: hai thiết bị không được thấy hai cây khác nhau. Dùng Postgres với transaction: commit version = kiểm tra parent_version khớp current_version (optimistic concurrency) → INSERT file_versions → UPDATE files → INSERT changes với cursor = nextval theo namespace, tất cả trong một transaction.
- Shard theo user_id (namespace cá nhân); thư mục chia sẻ là namespace riêng để mọi người cùng shard; cross-shard chỉ khi di chuyển file giữa namespace (hiếm, làm 2 pha).
- Cache Redis cho metadata đọc nhiều (danh sách file), invalidation theo namespace cursor; đọc đường sync luôn từ primary để không thấy cũ.

### 4.3 Thông báo thay đổi: long polling vs WebSocket
| Phương án | Ưu | Nhược |
|---|---|---|
| Client polling mỗi 10 s | Đơn giản | 10M client → 1M request/s vô ích, trễ 10 s |
| Long polling (chọn) | Gần realtime, qua được proxy, client đơn giản, kết nối không cần hai chiều | Mỗi kết nối chiếm tài nguyên server tới 60 s; reconnect liên tục |
| WebSocket | Hai chiều, ít overhead hơn | Phức tạp hơn, bị một số proxy chặn; không cần hai chiều ở đây |
Notification service giữ kết nối theo namespace; MQ đẩy file_changed → tìm kết nối đang chờ của namespace → trả về ngay chỉ với "có thay đổi, cursor mới" (payload nhỏ), client tự gọi /delta. 10M kết nối chờ → 20–40 node như gateway chat (C7).

### 4.4 Conflict, offline, cold storage, chia sẻ
- **Conflict**: commit với parent_version cũ → 409; client không ghi đè mà tạo bản sao "tên file (conflicted copy, thiết bị, ngày)" và upload như file mới; cả hai bản được giữ, user tự gộp. Đây là "last write wins + giữ bản thua", không mất dữ liệu.
- **Offline**: hàng đợi thao tác local theo thứ tự; khi online replay; xoá thư mục đã bị người khác sửa → server hỏi lại client.
- **Lịch sử và cold storage**: version 30 ngày → block chỉ còn tham chiếu từ version cũ chuyển sang tầng lạnh; ref_count về 0 sau grace period mới xoá; dọn rác chạy nền với bảng blocks, không quét S3.
- **Chia sẻ**: ACL ở resource (file hoặc thư mục) với kế thừa; link công khai = token ngẫu nhiên có hạn; kiểm tra quyền ở Metadata API cho mọi truy cập block (block hash không được là "bí mật" vì có thể đoán được qua dedup → phải kiểm quyền qua version chứa nó).

## 5. Trade-off & câu hỏi vặn (5 phút)
1. "Dedup toàn hệ thống có rủi ro gì?" → Lộ thông tin "block này đã tồn tại" cho phép dò file người khác; giảm bằng chỉ cho dedup phía server sau khi nhận block, hoặc chỉ dedup trong cùng user; đổi lại tiết kiệm ít hơn.
2. "File 10 GB upload bị đứt ở 9 GB?" → Block đã upload giữ nguyên trong 24 h, client hỏi check rồi gửi 1 GB còn lại.
3. "Hai người sửa cùng file chia sẻ cùng lúc?" → Người commit sau nhận 409 và tạo conflicted copy; với tài liệu cộng tác thật thì cần CRDT/OT, ngoài phạm vi.
4. "Metadata 25 TB có để Postgres không?" → Shard theo namespace, mỗi shard vài trăm GB; hoặc dùng DB phân tán có transaction (Spanner, CockroachDB) khi đội vận hành đủ.
5. "Client gửi hash sai hoặc độc hại?" → Server tính lại hash khi nhận block trước khi ghi index; không tin client.
6. "Đổi tên thư mục 100k file?" → Lưu path theo parent_id thay vì chuỗi đầy đủ → đổi tên là 1 dòng; delta chỉ báo 1 thay đổi.
7. "Xoá file rồi khôi phục trong 30 ngày?" → Soft delete, version còn, block còn tham chiếu; khôi phục là commit version mới trỏ block cũ, không upload lại.
8. "Đo gì?" → Thời gian từ commit tới thiết bị khác nhận notify (p95), tỉ lệ dedup, băng thông tiết kiệm, số conflict/ngày, lag garbage collection.

### Sai lầm hay gặp
- Lưu file nguyên khối, không chunk → delta sync bất khả thi.
- Metadata eventual consistency → hai thiết bị thấy hai cây khác nhau.
- Polling mỗi vài giây từ hàng triệu client.
- Xoá block ngay khi version bị xoá → mất dữ liệu của version khác tham chiếu.

## 6. Người phỏng vấn chấm gì
| Tiêu chí | Câu trả lời yếu | Câu trả lời mạnh |
|---|---|---|
| Lưu trữ | Upload cả file | Block 4 MB, hash, dedup, delta, resume |
| Metadata | Một bảng files | files, versions, blocks ref_count, changes cursor; transaction; shard theo namespace |
| Đồng bộ | Polling | Long polling + cursor delta; payload nhỏ; offline queue |
| Conflict | Ghi đè | Optimistic concurrency theo parent_version, conflicted copy, không mất dữ liệu |
| Chi phí và an toàn | Không | Cold storage, GC theo ref_count, kiểm quyền mọi block, không tin hash từ client |

### Nói thế nào trong phỏng vấn (EN)
- "Files are split into four megabyte blocks addressed by their SHA-256; a one kilobyte edit uploads one block, not the whole file." — Block 4 MB theo hash, sửa nhỏ chỉ gửi 1 block.
- "Metadata needs strong consistency, so commits run in a Postgres transaction with optimistic concurrency on the parent version." — Metadata strong consistency, optimistic concurrency.
- "Clients long poll a notification service and then fetch a delta from their cursor; the notification itself carries almost no payload." — Long poll rồi lấy delta theo cursor.
- "On conflict we never overwrite: the loser becomes a conflicted copy and the user merges." — Conflict thì tạo bản sao, không ghi đè.
- "Blocks are reference counted and garbage collected after a grace period, then tiered to cold storage." — Block đếm tham chiếu, dọn sau grace period, chuyển tầng lạnh.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- File SBOM và revision: mỗi lần khách re-upload, bạn parse lại toàn bộ và ghi lại component. Mô hình file_versions + block hash gợi ý: hash identity component (purl + hash nội dung) để biết component nào thực sự đổi giữa hai revision → delta sync cho t_project_revisions, giảm ghi và giảm drift (sự cố re-import map 2 lần gây drift license inline vs sweeper).
- Dedup toàn hệ thống và rủi ro lộ thông tin chính là bài học leak license cross-tenant "first-writer-wins" trên t_components: dữ liệu dùng chung phải có lớp quyền hoặc overlay theo tenant; ở đây là "kiểm quyền qua version chứa block, không tin hash".
- Metadata strong consistency: trạng thái project, revision hiện tại, kết quả policy phải đọc từ primary trong transaction; sự cố reconcile xoá mềm violation của lần eval tốt là hệ quả của cập nhật không theo version (không có parent_version để phát hiện ghi đè kết quả mới bằng kết quả cũ hoặc rỗng).
- Thông báo cho FE: long polling với cursor cho "có thay đổi trên project" đơn giản hơn WebSocket và đủ cho vài trăm user tenant; payload chỉ cursor, FE gọi delta.
- Cold storage: file SBOM gốc trong MinIO/S3 sau 90 ngày chuyển tầng lạnh; giữ hash để xác minh; GC theo ref_count cho revision đã xoá.
- Việc tuần này: thêm cột parent_revision_id hoặc version check vào API ghi kết quả policy để từ chối ghi đè kết quả mới bằng kết quả cũ (409); đo tỉ lệ component không đổi giữa hai revision liên tiếp của 10 project lớn để chứng minh giá trị của delta.
- Khi phỏng vấn, kể câu chuyện reconcile wipe 910k violation để minh hoạ vì sao optimistic concurrency theo version quan trọng.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao chia file thành block 4 MB với hash thay vì upload cả file?', o: ['Để mã hoá dễ hơn', 'Để sửa nhỏ chỉ upload block thay đổi, dedup block trùng và resume theo block', 'Vì object storage giới hạn 4 MB', 'Để metadata nhỏ hơn'], a: 1, why: 'Chunking là nền của delta sync, dedup và resumable upload; metadata thực ra lớn hơn.' },
    { t: 'mc', q: 'Metadata của cây thư mục nên dùng mức consistency nào và vì sao?', o: ['Eventual, vì đồng bộ chậm vài giây không sao', 'Strong, vì các thiết bị phải thấy cùng một cây thư mục và version, commit kiểm tra parent_version trong transaction', 'Không cần DB, lưu trong file', 'Chỉ cần cache Redis'], a: 1, why: 'Hai thiết bị thấy hai cây khác nhau là lỗi dữ liệu; optimistic concurrency phát hiện conflict.' },
    { t: 'mc', q: 'Khi commit với parent_version cũ bị 409, client nên làm gì?', o: ['Ghi đè bằng force', 'Bỏ thay đổi local', 'Tạo bản conflicted copy và upload như file mới, giữ cả hai bản', 'Chờ server tự gộp'], a: 2, why: 'Không mất dữ liệu của ai; user tự gộp; gộp tự động cần CRDT/OT và ngoài phạm vi.' },
    { t: 'mc', q: 'Vì sao chọn long polling cho thông báo sync thay vì polling định kỳ?', o: ['Long polling rẻ hơn WebSocket về mọi mặt', 'Polling 10 s từ 10M client tạo hàng triệu request vô ích mỗi giây và trễ tới 10 s, long polling trả ngay khi có thay đổi với ít request', 'Long polling không cần server', 'Polling không qua được proxy'], a: 1, why: 'Kết nối chờ tới 60 s rồi trả, gần realtime và qua proxy tốt; không cần hai chiều nên không cần WebSocket.' },
    { t: 'mc', q: 'Khi nào được xoá vật lý một block khỏi object storage?', o: ['Ngay khi file bị xoá', 'Khi version mới nhất không dùng nó', 'Khi ref_count về 0 và đã qua grace period', 'Sau 24 giờ bất kể'], a: 2, why: 'Block có thể thuộc nhiều version và nhiều user; xoá sớm làm hỏng file khác.' },
    { t: 'fill', q: 'Điền: thiết bị khác gọi GET /delta?___= để lấy danh sách thay đổi kể từ lần đồng bộ trước.', a: ['cursor'], why: 'Cursor tăng dần theo namespace cho phép lấy đúng phần thay đổi, idempotent khi gọi lại.' },
    { t: 'fill', q: 'Điền: kỹ thuật chia block theo nội dung bằng Rabin fingerprint để chèn xoá không dịch mọi block gọi là ___ chunking.', a: ['content-defined', 'content defined', 'variable', 'cdc'], why: 'Block cố định mất dedup phần sau khi chèn 1 byte đầu file; CDC khắc phục với giá CPU.' },
    { t: 'open', q: 'Người phỏng vấn hỏi: "Laptop của tôi offline cả ngày và sửa 3 file; điện thoại tôi cũng sửa 1 trong 3 file đó. Khi laptop online lại, chuyện gì xảy ra?" Trả lời 3–5 câu.', a: 'Laptop replay hàng đợi offline theo thứ tự: với mỗi file, check block đã có, upload block thiếu, rồi commit kèm parent_version mà nó biết. Hai file không bị động tới commit thành công và tạo version mới, điện thoại nhận notify rồi lấy delta và tải block. File thứ ba bị 409 vì parent_version đã cũ do điện thoại commit trước; laptop không ghi đè mà tạo "tên file (conflicted copy)" và upload như file mới. Cả hai bản xuất hiện trên mọi thiết bị, user tự gộp; không ai mất dữ liệu.', keys: ['hàng đợi', 'parent_version', '409', 'conflicted copy', 'delta'] }
  ]
}
];

/* ===== Đề mock M1–M10, mỗi đề nối với bài case cùng số ===== */
window.MOCKS = window.MOCKS || [];
window.MOCKS.push({
  id: 'M1', caseId: 'C1', title: 'Design a URL shortener', level: 1,
  prompt: `"Design a URL shortening service like TinyURL. Users submit a long URL and get a short one; opening the short link redirects to the original. Expect about 100 million new URLs a month."
Thiết kế dịch vụ rút gọn URL kiểu TinyURL: nhận URL dài trả URL ngắn, mở link ngắn thì redirect về gốc; khoảng 100 triệu URL mới mỗi tháng.`,
  clarify: [
    'Hỏi: Tỉ lệ đọc/ghi khoảng bao nhiêu? → Đáp: 10:1, redirect nhiều hơn tạo link.',
    'Hỏi: Short key dài bao nhiêu, bảng chữ nào? → Đáp: càng ngắn càng tốt, chữ và số.',
    'Hỏi: Có custom alias không? → Đáp: có, tuỳ chọn, phải duy nhất.',
    'Hỏi: Link có hết hạn không? → Đáp: mặc định 5 năm, user đặt được.',
    'Hỏi: Cần analytics không, realtime không? → Đáp: cần tổng click và theo quốc gia, trễ vài phút được.',
    'Hỏi: Có xoá hoặc đổi đích không? → Đáp: xoá có, đổi đích không.',
    'Hỏi: Yêu cầu sẵn sàng và độ trễ redirect? → Đáp: 99,99%, p99 dưới 50 ms phía server.'
  ],
  phases: {
    req: { checks: ['Nêu được tỉ lệ đọc/ghi và nói hệ là read-heavy', 'Chốt functional: tạo, redirect, alias, TTL, thống kê, xoá', 'Chốt non-functional: p99 redirect, 99,99%, key không trùng', 'Nói rõ ngoài phạm vi (auth chi tiết, chống phishing nâng cao)'],
      hint: `Bắt đầu bằng câu hỏi tỉ lệ đọc/ghi, rồi hỏi alias, TTL, analytics.
Chốt lại thành 3 nhóm: Functional, Non-functional, Ngoài phạm vi.
Nhấn mạnh: short key trùng là sự cố bảo mật, redirect nằm trên đường đi của mọi click.` },
    est: { checks: ['Ghi ≈ 40 QPS, đọc ≈ 400 QPS, đỉnh ×3', '6 tỷ URL sau 5 năm, ~500 B mỗi dòng → ~3 TB', 'Base62: 62^6 ≈ 56 tỷ, 62^7 ≈ 3,5 nghìn tỷ → chọn 7 ký tự', 'Cache 20% link nóng ≈ vài GB, một Redis node đủ'],
      hint: `100M / (30 × 86 400) ≈ 40 QPS ghi; ×10 → 400 QPS đọc.
100M × 12 × 5 = 6 tỷ dòng × 500 B ≈ 3 TB.
62^7 ≈ 3,5 × 10^12. Kết luận: bài toán là sinh key và độ trễ redirect, không phải throughput.` },
    hld: { checks: ['Sơ đồ có LB, API, Redis cache, DB, KGS, queue analytics', 'Mô tả write path (lấy key → INSERT) và read path (cache → DB → 302)', 'API: POST /urls, GET /{key}, DELETE, GET stats', 'Bảng urls với PK short_key; analytics tách sang OLAP'],
      hint: `Vẽ: Client → LB → API → Redis (cache-aside) và DB; API ← KGS cấp range; API → queue click → worker → OLAP.
Nói rõ redirect không chờ ghi analytics.
Chọn DB theo PK lookup: KV hoặc Postgres partition, nêu ngưỡng chuyển.` },
    deep: { checks: ['So sánh hash-cắt vs counter vs KGS range, nêu collision và tính tuần tự', '301 vs 302: cache trình duyệt vs analytics và thu hồi', 'Hot key: local cache, negative cache hoặc Bloom filter', 'Expiry bằng partition theo thời gian + xoá lazy'],
      hint: `Điểm nóng 1: sinh key. Hash cắt → collision check; counter → tuần tự và SPOF; KGS cấp range + hoán vị bit → chọn.
Điểm nóng 2: 302 để giữ analytics; 301 khi tối ưu tải và không cần thống kê.
Điểm nóng 3: cache-aside, viral key, Bloom filter chống dò.` },
    wrap: { checks: ['Nêu 2–3 trade-off đã chọn và điều kiện đổi quyết định', 'Trả lời được KGS chết, link xoá còn trong cache, alias trùng', 'Nêu metric: p99 redirect, hit ratio, queue lag'],
      hint: `Tóm tắt: read-heavy → cache; key bằng counter range; 302 vì analytics; analytics bất đồng bộ.
Nêu điều gì bạn sẽ làm khác nếu ghi tăng 1000 lần (shard theo hash key).` }
  },
  followups: [
    'What happens if two users shorten the same long URL?',
    'How do you prevent people from guessing sequential short keys?',
    'Why 302 and not 301? When would you flip that decision?',
    'How would you handle a single link that suddenly gets 50 thousand requests per second?',
    'What if the key generation service goes down?',
    'How do you clean up billions of expired links without hurting the database?',
    'How would you detect and block phishing links?',
    'How does your design change if we need multi-region active-active?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: mở đầu bằng tỉ lệ đọc/ghi; ước lượng ra 40/400 QPS và 3 TB trong 2 phút; so sánh 3 cách sinh key và chọn có lý do; 302 vs 301 giải thích bằng hành vi cache trình duyệt; analytics tách khỏi đường redirect.
**Bẫy thường gặp**:
- Dành 10 phút cho hash MD5 rồi không trả lời được collision.
- Quên nói key không được trùng là vấn đề bảo mật, không chỉ là lỗi.
- Ghi click đồng bộ, hoặc ngược lại không có analytics gì.
- Ước lượng dung lượng sai cả nghìn lần vì nhầm MB với KB.
**Dấu hiệu senior**: nói được khi nào quyết định đổi (301 nếu bỏ analytics, KV store nếu ghi tăng); nhắc negative cache và Bloom filter cho dò key; nêu metric và partition theo thời gian cho expiry; đề cập hoán vị bit để che tính tuần tự.
**Thời gian**: đề dễ, người phỏng vấn kỳ vọng xong HLD trong 15 phút và dành phần lớn thời gian vặn về key và cache.`
});
window.MOCKS.push({
  id: 'M2', caseId: 'C2', title: 'Design a distributed rate limiter', level: 2,
  prompt: `"Design a rate limiter for our public API. It must enforce per-client limits consistently across all API servers and tell clients when they are throttled."
Thiết kế rate limiter cho API công khai: áp hạn mức theo client một cách nhất quán trên mọi API server và báo cho client biết khi bị chặn.`,
  clarify: [
    'Hỏi: Giới hạn theo chiều nào: API key, user, IP, tenant, endpoint? → Đáp: API key là chính, có rule theo tenant và endpoint.',
    'Hỏi: Rule ví dụ? → Đáp: 100 request/phút mỗi key, 10 000/phút mỗi tenant, endpoint nặng 10/phút.',
    'Hỏi: Cần chính xác tuyệt đối hay chấp nhận lệch vài %? → Đáp: lệch 1–5% được, không chặn nhầm nhiều.',
    'Hỏi: Quy mô? → Đáp: 100k RPS, 1M API key hoạt động, 20 API server.',
    'Hỏi: Khi limiter lỗi thì cho qua hay chặn? → Đáp: anh đề xuất.',
    'Hỏi: Có cần burst cho tenant trả tiền không? → Đáp: có.',
    'Hỏi: Thêm độ trễ bao nhiêu là chấp nhận? → Đáp: dưới 2 ms p99.'
  ],
  phases: {
    req: { checks: ['Liệt kê các chiều giới hạn và ví dụ rule cụ thể', 'Nêu yêu cầu độ chính xác (lệch vài % được) và độ trễ thêm', 'Nêu hành vi khi bị chặn: 429 và header', 'Đặt câu hỏi fail-open hay fail-closed'],
      hint: `Hỏi chiều giới hạn, rule mẫu, độ chính xác, quy mô, hành vi khi Redis lỗi, burst.
Chốt: limiter ở gateway, rule đổi không cần deploy, 429 + Retry-After.` },
    est: { checks: ['100k kiểm tra/s = 100k round trip Redis/s → 2–3 shard', 'Round trip Redis ~0,5 ms → p99 cộng ~1 ms', 'Bộ nhớ sliding window counter ~160 MB cho 1M key; sliding log hàng GB', 'Rule config dưới 1 MB, cache in-process'],
      hint: `Mỗi request 1 lần kiểm tra → 100k ops/s; 1 Redis node ~100k ops/s nên cần shard để có headroom.
1M key × 2 counter × 80 B ≈ 160 MB. Sliding log: 1M × 100 timestamp × 8 B ≈ 800 MB chưa kể overhead.` },
    hld: { checks: ['Sơ đồ: client → gateway (limiter) → Redis cluster; rule store + cache; metrics', 'Luồng một request: tra rule → Lua → allowed/remaining/reset → header hoặc 429', 'Luồng cập nhật rule qua pub/sub, không deploy', 'Cấu trúc key Redis và TTL'],
      hint: `Limiter là middleware trong gateway, gọi 1 script Lua trên Redis với key rl:{api_key}:{endpoint}.
Rule lưu Postgres, cache in-process, reload qua pub/sub.
Header: X-RateLimit-Limit, Remaining, Reset; chặn thì 429 + Retry-After.` },
    deep: { checks: ['So sánh token bucket, leaky bucket, fixed window, sliding log, sliding counter; chọn theo yêu cầu', 'Giải thích race GET/INCR và vì sao Lua atomic; hash tag cho cluster', 'So sánh counter local vs tập trung vs sync định kỳ', 'Fail-open theo endpoint, timeout ngắn, soft limit'],
      hint: `Fixed window bị đỉnh đôi ở biên. Sliding window counter: prev × tỉ lệ còn chồng + cur.
Lua: GET prev, GET cur, tính, INCR, PEXPIRE trong một script.
Fail-open cho đa số, fail-closed cho login/OTP; timeout Redis 5–10 ms.` },
    wrap: { checks: ['Tóm tắt lựa chọn thuật toán và lý do', 'Nêu hành vi khi Redis chết và cách phát hiện', 'Nêu test biên cửa sổ và metric allowed/rejected'],
      hint: `Nhắc lại: sliding window counter cho rule phút, token bucket cho burst; Redis Lua atomic; gateway; fail-open có cảnh báo.
Nêu một điều bạn sẽ đo sau khi deploy: tỉ lệ 429 theo tenant.` }
  },
  followups: [
    'Two requests hit two different servers at the same instant with one slot left. What happens?',
    'How do you handle clock skew between gateway nodes?',
    'Why not just use INCR and EXPIRE?',
    'What do you do when Redis is unreachable?',
    'How would you support both a per-key and a per-tenant limit on the same request?',
    'How do you test the window boundary behaviour?',
    'Would you rate limit outbound calls to third-party APIs the same way?',
    'What headers do you return and why do they matter for clients?',
    'How does this work in a Redis cluster where keys live on different nodes?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: biết ít nhất 4 thuật toán và chọn theo yêu cầu độ chính xác và bộ nhớ; chỉ ra race cụ thể giữa GET và INCR và giải bằng Lua; quyết định fail-open theo endpoint chứ không một kiểu cho cả hệ; trả header đầy đủ.
**Bẫy thường gặp**:
- Chỉ biết fixed window và không thấy đỉnh biên.
- Nói "INCR rồi EXPIRE" mà không thấy race và key sống mãi khi EXPIRE không chạy.
- Counter local mỗi node và không nhận ra limit bị nhân theo số node.
- Không bàn tới chuyện Redis chết, hoặc chọn fail-closed cho mọi thứ.
**Dấu hiệu senior**: dùng thời gian của Redis để tránh clock skew; hash tag trong Redis cluster; timeout rất ngắn để limiter không kéo p99; soft limit và burst cho tenant trả tiền; nhắc tới limiter outbound cho API bên thứ ba; nói được metric 429 theo tenant để phát hiện rule sai.
**Thời gian**: HLD ngắn, 60% thời gian dành cho thuật toán và tính đúng đắn phân tán.`
});
window.MOCKS.push({
  id: 'M3', caseId: 'C3', title: 'Design a key-value store', level: 3,
  prompt: `"Design a distributed key-value store with put and get. It should scale to hundreds of nodes, stay available when nodes fail, and let clients tune consistency."
Thiết kế KV store phân tán với put/get; scale tới hàng trăm node; vẫn sẵn sàng khi node hỏng; client chỉnh được mức consistency.`,
  clarify: [
    'Hỏi: Kích thước key và value? → Đáp: key dưới 1 KB, value dưới 10 KB.',
    'Hỏi: Tổng dữ liệu và QPS? → Đáp: 100 TB, 300k đọc/s, 100k ghi/s.',
    'Hỏi: Khi partition ưu tiên availability hay consistency? → Đáp: availability, nhưng cho phép strong read theo request.',
    'Hỏi: Có range query không? → Đáp: không, chỉ theo key.',
    'Hỏi: Một hay nhiều datacenter? → Đáp: một DC trước.',
    'Hỏi: Cần transaction nhiều key không? → Đáp: không.',
    'Hỏi: Yêu cầu độ trễ? → Đáp: p99 get dưới 10 ms.'
  ],
  phases: {
    req: { checks: ['Chốt API put/get/delete và tunable consistency', 'Nêu AP khi partition, strong read tuỳ chọn', 'Nêu yêu cầu thêm node chỉ dời ~1/N dữ liệu', 'Loại trừ range query, transaction, SQL'],
      hint: `Hỏi kích thước, QPS, CAP khi partition, range query, số DC.
Chốt non-functional: p99 10 ms, 99,99%, mất 1–2 node không mất dữ liệu, tunable consistency.` },
    est: { checks: ['100 TB × 3 replica = 300 TB → ~100 node 4 TB', 'Mỗi node ~3k đọc và ~3k ghi mỗi giây, dễ', 'Băng thông ghi ~3 GB/s cụm, 30 MB/s mỗi node', 'Kết luận: khó ở phân phối đều, phục hồi, conflict chứ không ở tải'],
      hint: `10 tỷ key × 10 KB = 100 TB; ×3 = 300 TB; mỗi node 3 TB hữu ích → 100 node.
300k đọc / 100 node = 3k, nhân 2–3 replica mỗi lần đọc ≈ 9k ops/node.` },
    hld: { checks: ['Sơ đồ: client → coordinator → ring → N replica; gossip; hinted handoff; LSM trong node', 'Write path: hash → preference list → ghi song song → chờ W', 'Read path: chờ R → hoà giải → read repair', 'Cấu trúc node: commit log, memtable, SSTable, Bloom filter'],
      hint: `Mọi node là coordinator được. Ring consistent hashing với vnode; preference list N node khác máy vật lý.
Trong node: commit log → memtable → SSTable, compaction nền.` },
    deep: { checks: ['Consistent hashing + vnode vs mod N vs range; vì sao vnode', 'N, W, R; điều kiện W + R > N; bảng cấu hình theo use case', 'Vector clock vs LWW vs CRDT; sibling và client hoà giải', 'Gossip, hinted handoff (tạm), Merkle anti-entropy (lâu); tombstone cho delete'],
      hint: `Phân vùng: vnode 100–200 mỗi node, bỏ qua vnode cùng máy.
Quorum: W = R = 2 mặc định; nói rõ không phải linearizable tuyệt đối.
Conflict: vector clock, cắt khi quá 10 entry.
Lỗi: gossip phát hiện; sloppy quorum + hint; Merkle tree so sánh range.` },
    wrap: { checks: ['Tóm tắt 5 cơ chế chính và trade-off AP', 'Trả lời hot key, thêm nhiều node, delete đúng cách', 'Nêu điều gì sẽ khác nếu cần strong consistency (Raft, leader)'],
      hint: `Tóm tắt: ring + vnode, N/W/R, vector clock, hinted handoff + Merkle, LSM.
Nói rõ hệ này là AP; nếu cần CP thì sang Raft-based như etcd hoặc Spanner-style.` }
  },
  followups: [
    'Why virtual nodes? What goes wrong without them?',
    'With N equals 3, which W and R would you pick and why?',
    'Two clients write the same key during a partition. Walk me through what happens on read.',
    'How does a node learn that another node is dead without a central coordinator?',
    'What is the difference between hinted handoff and Merkle tree anti-entropy?',
    'How do you delete a key safely in this system?',
    'How do you handle a hot key that consistent hashing cannot spread?',
    'Why an LSM tree rather than a B-tree for the storage engine?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: trình bày theo lớp: phân vùng → replication → consistency → lỗi → storage engine; mỗi lớp 2–3 phương án và chọn; nói được điều kiện W + R > N và giới hạn của nó; phân biệt hỏng tạm và hỏng lâu.
**Bẫy thường gặp**:
- Nói "consistent hashing" nhưng không giải thích được vì sao cần vnode.
- Khẳng định quorum là strong consistency tuyệt đối.
- Giải conflict bằng timestamp mà không nhắc clock lệch.
- Delete bằng xoá vật lý, không có tombstone.
- Nhầm consistent hashing giải quyết hot key.
**Dấu hiệu senior**: nhắc sloppy quorum và hậu quả; preference list bỏ qua cùng rack; cắt vector clock; đọc từ Bloom filter tới compaction strategy; biết nói "nếu cần CP thì dùng hệ khác" thay vì cố vặn Dynamo thành CP.
**Thời gian**: đề khó, đừng sa đà vào LSM quá 3 phút; người phỏng vấn chấm nặng ở replication và failure handling.`
});
window.MOCKS.push({
  id: 'M4', caseId: 'C4', title: 'Design a unique ID generator', level: 1,
  prompt: `"Design a service that generates unique IDs across our distributed system. IDs must be unique, roughly time-sortable, fit in 64 bits, and we need at least ten thousand per second."
Thiết kế bộ sinh ID duy nhất cho hệ phân tán: duy nhất, sắp xếp gần đúng theo thời gian, 64 bit, ít nhất 10 000 ID mỗi giây.`,
  clarify: [
    'Hỏi: ID là số hay chuỗi? → Đáp: số nguyên 64 bit.',
    'Hỏi: Cần liên tục hay chỉ cần tăng dần? → Đáp: tăng dần theo thời gian là đủ, có khoảng trống được.',
    'Hỏi: Có được lộ thời điểm tạo không? → Đáp: được; không muốn lộ tổng số bản ghi.',
    'Hỏi: Bao nhiêu node sinh ID, có cần sinh không gọi mạng không? → Đáp: vài trăm instance, sinh local là lý tưởng.',
    'Hỏi: Hệ sống bao lâu? → Đáp: 50 năm trở lên.',
    'Hỏi: Đồng hồ máy có thể lệch hay nhảy lùi? → Đáp: có NTP nhưng vẫn có thể.'
  ],
  phases: {
    req: { checks: ['Tách rõ 4 yêu cầu: duy nhất, sortable, 64 bit, throughput', 'Hỏi về đồng hồ và số node', 'Nêu không cần liên tục và không trung tâm trên đường nóng'],
      hint: `Hỏi: số hay chuỗi, liên tục hay tăng dần, lộ thông tin, số node, tuổi thọ, đồng hồ.
Chốt: sinh local không I/O, micro giây, chịu clock lệch.` },
    est: { checks: ['41 bit ms ≈ 69 năm', '12 bit sequence = 4 096/ms ≈ 4M/s mỗi node', '10 bit node = 1 024 node', 'So sánh 8 B vs 16 B UUID cho index'],
      hint: `2^41 ms / (3,15 × 10^10 ms/năm) ≈ 69 năm. 2^12 = 4 096. 2^10 = 1 024.
1 + 41 + 10 + 12 = 64. Nhu cầu 2M ID/s toàn hệ là rất nhỏ so với khả năng.` },
    hld: { checks: ['Lib in-process: đọc clock, sequence, node id, ghép bit', 'Cấp node id từ etcd/ZooKeeper với lease hoặc StatefulSet ordinal', 'Epoch tuỳ chỉnh để kéo dài tuổi thọ', 'Hàm Decode để debug'],
      hint: `Không có service gọi mạng trên đường nóng; chỉ node id là lấy lúc khởi động.
ID = (ts - epoch) << 22 | node << 12 | seq. Thread-safe bằng mutex hoặc CAS.` },
    deep: { checks: ['Bảng so sánh multi-master increment, UUID v4, UUID v7, ticket server, Snowflake', 'Giải thích vì sao ID theo thời gian tốt cho B-tree và keyset pagination', 'Clock backwards: chờ nếu nhỏ, từ chối và alert nếu lớn, không dùng wall clock đã lùi', 'Cấp node id an toàn khi autoscale: ephemeral + lease, không cấp lại ngay'],
      hint: `UUID v4: 128 bit, chèn ngẫu nhiên → page split. UUID v7: sortable nhưng vẫn 128 bit.
Ticket server: SPOF, round trip mỗi ID. Snowflake: khớp 4 yêu cầu, phụ thuộc clock.
Clock lùi dưới 10 ms → sleep; lớn hơn → lỗi + alert.` },
    wrap: { checks: ['Tóm tắt layout và 2 rủi ro chính (clock, node id)', 'Nêu khi nào chọn UUID v7 thay vì Snowflake', 'Nêu cách test duy nhất với nhiều goroutine và clock giả'],
      hint: `Nhắc lại layout, 69 năm, 4 096/ms.
Nếu được phép 128 bit và không có registry: UUID v7.
Test: 1 000 goroutine × 10 000 ID vào set.` }
  },
  followups: [
    'Why not just use UUIDs?',
    'What happens when the system clock moves backwards?',
    'How do you assign node ids safely when instances autoscale?',
    'What does the ID reveal about your system, and is that a problem?',
    'How does a time-ordered ID help the database?',
    'What if a single node needs more than 4096 IDs in one millisecond?',
    'How would you generate IDs inside a serverless function with no stable node id?',
    'How would you test that IDs are truly unique?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tách yêu cầu thành 4 ý; bảng 5 phương án với lý do loại từng cái; tính được 69 năm, 4 096/ms, 1 024 node; xử lý clock lùi có ngưỡng; nói được tác động của ID lên B-tree index.
**Bẫy thường gặp**:
- "Dùng UUID" rồi dừng, không bàn 128 bit và chèn ngẫu nhiên.
- Cộng bit không ra 64 hoặc quên bit dấu.
- Nói NTP lo đồng hồ, không có phương án khi lùi.
- Node id cấu hình tay mà không nói chuyện trùng khi autoscale.
**Dấu hiệu senior**: epoch tuỳ chỉnh; lease và không cấp lại node id ngay; biết UUID v7 và khi nào nó hợp hơn Snowflake (serverless, không registry); liên hệ keyset pagination và dung lượng index; đề xuất test với clock giả.
**Thời gian**: đề ngắn; người phỏng vấn thường dùng nó để dẫn sang DB index hoặc clock trong hệ phân tán, hãy sẵn sàng chuyển chủ đề.`
});
window.MOCKS.push({
  id: 'M5', caseId: 'C5', title: 'Design a notification system', level: 2,
  prompt: `"Design a notification system that sends push, SMS and email. Internal services trigger notifications; we need reliability, respect for user preferences, and delivery tracking."
Thiết kế hệ gửi thông báo push, SMS, email: các service nội bộ kích hoạt; cần tin cậy, tôn trọng thiết lập của user, và theo dõi trạng thái gửi.`,
  clarify: [
    'Hỏi: Kênh và provider? → Đáp: APNs, FCM, Twilio, SES; thiết kế để thêm kênh.',
    'Hỏi: Khối lượng? → Đáp: 10M push, 1M SMS, 5M email mỗi ngày; đỉnh ×10.',
    'Hỏi: Yêu cầu độ trễ? → Đáp: OTP dưới 10 giây; marketing trễ vài phút được.',
    'Hỏi: Được mất hay gửi trùng không? → Đáp: không mất OTP; không gửi trùng marketing.',
    'Hỏi: Preference, opt-out, quiet hours? → Đáp: có theo kênh và loại; quiet hours cho push.',
    'Hỏi: Tracking tới mức nào, lưu bao lâu? → Đáp: sent, delivered, opened, failed; 90 ngày.',
    'Hỏi: Template ai quản, đa ngôn ngữ? → Đáp: team sản phẩm, có.'
  ],
  phases: {
    req: { checks: ['Phân biệt transactional (OTP) và marketing về độ trễ và opt-out', 'Chốt at-least-once + dedup, không exactly-once tuyệt đối', 'Nêu preference, quiet hours, template, tracking', 'Nêu mức ưu tiên'],
      hint: `Hỏi kênh, khối lượng, độ trễ theo loại, mất/trùng, preference, tracking, template.
Chốt: 16M/ngày, đỉnh 2k/s, OTP p95 dưới 10 s, chịu provider chết.` },
    est: { checks: ['16M/ngày ≈ 185/s, đỉnh ≈ 2 000/s', 'Gọi provider ~2 400/s đỉnh so với hạn mức provider → cần queue và rate limit', 'Tracking 16 GB/ngày → 1,5 TB/90 ngày', 'Backlog 1 giờ provider chết ≈ 7M message, 7 GB'],
      hint: `10M + 1M + 5M = 16M; chia 86 400 ≈ 185/s; ×10 đỉnh.
Mỗi message ~1 KB trạng thái + event. Queue phải chứa được vài giờ backlog.` },
    hld: { checks: ['Sơ đồ: services → API → preference/template → queue theo kênh và ưu tiên → worker → adapter → provider; webhook → tracking; DLQ', 'Luồng: dedup → preference → render → ghi DB → commit → publish → 202', 'Worker: rate limit → gọi → phân loại lỗi → ack/nack delay → DLQ', 'Bảng notifications, events, preferences, templates, devices'],
      hint: `Tách queue: push.high, push.low, sms, email. Adapter interface cho provider.
Publish sau commit hoặc outbox. Webhook provider cập nhật delivered/bounced.` },
    deep: { checks: ['Không mất: outbox, ack sau provider, prefetch nhỏ; không trùng: idempotency key, trạng thái trước khi gọi, collapse id', 'Phân loại lỗi tạm/vĩnh viễn; backoff mũ có jitter; DLQ có replay', 'Token bucket chung theo provider; ưu tiên high không bị low chiếm hạn mức', 'Preference kiểm tra 2 lần; quiet hours bằng delayed queue; template version trong message'],
      hint: `Outbox: ghi notification + outbox cùng transaction, relay publish.
Lỗi 400 invalid token → failed ngay + cập nhật device; 5xx/timeout → retry 1 s, 10 s, 1 phút, 10 phút.
Worker high có pool riêng; low giới hạn 70% hạn mức.` },
    wrap: { checks: ['Tóm tắt cơ chế tin cậy và cô lập ưu tiên', 'Trả lời provider chết 30 phút, webhook trùng, 5M email lúc 9h', 'Nêu metric: tuổi message cũ nhất theo ưu tiên, DLQ count, delivered rate'],
      hint: `Tóm tắt: queue theo kênh/ưu tiên, outbox, idempotency, phân loại lỗi, DLQ, rate limit provider.
Metric số 1: queue lag theo ưu tiên; alert OTP lag quá 5 s.` }
  },
  followups: [
    'A worker sends successfully but crashes before acking. How do you avoid a duplicate?',
    'What do you do when the SMS provider is down for thirty minutes?',
    'How do you make sure a marketing blast never delays an OTP?',
    'How do you classify provider errors, and why does it matter?',
    'Why an outbox table instead of publishing right after the database write?',
    'How do you enforce a vendor rate limit across twenty workers?',
    'What metric tells you the system is falling behind?',
    'How do you handle a user who turns off notifications while a message is already queued?',
    'Where does personal data live in this pipeline and how do you protect it?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: nhìn hệ như pipeline tin cậy: ghi bền → publish sau commit → worker idempotent → phân loại lỗi → DLQ; tách queue theo kênh và ưu tiên; rate limit theo provider; preference kiểm tra hai lần; metric queue lag.
**Bẫy thường gặp**:
- Một queue cho tất cả, OTP xếp sau marketing.
- Retry mọi lỗi như nhau, bị provider khoá tài khoản.
- Publish trước khi commit, hoặc hứa exactly-once.
- DLQ không có ai xem, không có replay.
- Quên transactional không bị opt-out marketing chặn.
**Dấu hiệu senior**: outbox pattern; collapse id và idempotency của từng provider; delayed queue cho quiet hours; template version trong message; producer-side throttling cho batch marketing; webhook idempotent theo provider_msg_id và xử lý event đến sớm.
**Liên hệ công việc**: nếu bạn từng gặp publisher không reconnect hay publish trước commit, kể ngắn 30 giây, người phỏng vấn đánh giá cao kinh nghiệm thật.`
});
window.MOCKS.push({
  id: 'M6', caseId: 'C6', title: 'Design a news feed', level: 2,
  prompt: `"Design the news feed for a social network: users post, follow others, and see recent posts from people they follow. Assume 300 million daily active users and some accounts with tens of millions of followers."
Thiết kế news feed cho mạng xã hội: đăng bài, theo dõi, xem bài mới từ người mình theo dõi; 300 triệu DAU, một số tài khoản có hàng chục triệu follower.`,
  clarify: [
    'Hỏi: Feed theo thời gian hay có ranking? → Đáp: thời gian trước, chừa chỗ cho ranking.',
    'Hỏi: Bài có media không? → Đáp: có, feed chỉ trả URL, media qua CDN.',
    'Hỏi: Số follow trung bình và tối đa? → Đáp: trung bình 200; celebrity 10M+ follower.',
    'Hỏi: Bài mới phải thấy sau bao lâu? → Đáp: vài giây tới 1 phút.',
    'Hỏi: Tỉ lệ user hoạt động thật mỗi ngày? → Đáp: khoảng 1/3 mở app mỗi ngày.',
    'Hỏi: Có ads, gợi ý, search không? → Đáp: ngoài phạm vi.',
    'Hỏi: Mục tiêu độ trễ mở feed? → Đáp: p99 dưới 500 ms.'
  ],
  phases: {
    req: { checks: ['Chốt functional: đăng bài, follow, feed phân trang, like đếm', 'Chốt non-functional: p99 500 ms, bài mới trong vài giây, eventual consistency cho feed', 'Hỏi về celebrity và số follow trung bình', 'Loại trừ ads, ranking ML, search'],
      hint: `Câu hỏi quan trọng nhất: phân bố follower (trung bình vs celebrity) vì nó quyết định fan-out.
Chốt feed là eventual: bài mới trễ vài giây được, nhưng mở feed phải nhanh.` },
    est: { checks: ['150M bài/ngày ≈ 1 700/s; đọc 3 tỷ/ngày ≈ 35k QPS, đỉnh 100k', 'Fan-out on write: 30 tỷ chèn/ngày ≈ 350k chèn/s', 'Feed cache: 300M × 300 id × 8 B, chỉ user hoạt động → ~240 GB', 'Media ~22 TB/ngày lên object storage và CDN'],
      hint: `300M × 0,5 bài = 150M/ngày. 300M × 10 lần mở = 3 tỷ/ngày.
150M × 200 follower = 30 tỷ chèn → 350k/s: đây là con số làm người phỏng vấn gật đầu.
Celebrity 10M follower đăng 1 bài = 10M chèn → không thể push.` },
    hld: { checks: ['Sơ đồ: Post service → PostDB + Kafka → fan-out workers → Graph service → feed cache Redis; Feed service đọc cache và hydrate', 'Luồng đăng bài và luồng đọc feed có merge celebrity', 'API với cursor phân trang bằng post_id time-ordered', 'Feed cache chỉ chứa post id; Post cache chứa nội dung'],
      hint: `Đăng: ghi PostDB → Kafka → worker lấy follower → ZADD feed:{user}.
Đọc: ZREVRANGE 20 id → merge bài celebrity từ author cache → MGET nội dung → trả.
Cursor = post_id cuối, không OFFSET.` },
    deep: { checks: ['Push vs pull vs hybrid với ngưỡng celebrity; bỏ qua user không hoạt động', 'Sorted set score = post_id: idempotent, cắt 300, chỉ id', 'Hot path đọc: ZREVRANGE + merge + MGET, p99 vài chục ms; fallback pull khi mất shard', 'Like/view bất đồng bộ; ranking là lớp re-rank không đổi kiến trúc'],
      hint: `Hybrid: push cho author thường, pull cho celebrity (trên 1M follower), merge lúc đọc.
Sorted set ZADD idempotent nên Kafka redelivery vô hại.
Xoá bài chỉ cần xoá Post cache; feed cache còn id nhưng hydrate không ra.` },
    wrap: { checks: ['Tóm tắt lý do chọn hybrid và cấu trúc cache', 'Trả lời unfollow, user quay lại sau 6 tháng, Kafka lag', 'Nêu metric: lag fan-out, hit ratio feed cache, p99 đọc feed'],
      hint: `Nhắc lại: đọc gấp 20 ghi → tính trước; celebrity → pull; cache chỉ id.
Metric số 1: consumer lag của topic post_created.` }
  },
  followups: [
    'A celebrity with twenty million followers posts. What happens in your system?',
    'Why store only post ids in the feed cache?',
    'A user comes back after six months of inactivity. How do you build their feed?',
    'What happens when I unfollow someone and their posts are still in my cached feed?',
    'How do you paginate the feed without duplicates when new posts arrive?',
    'What is the first metric you would alert on?',
    'How would you add ranking without redesigning the system?',
    'What happens if a Redis shard holding feed caches dies?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tính ra 350k chèn/s để chứng minh push thuần không ổn với celebrity; chọn hybrid với ngưỡng rõ ràng; cache chỉ chứa id trong sorted set score = post_id; cursor keyset; like/view bất đồng bộ; nói được fallback pull khi cache mất.
**Bẫy thường gặp**:
- Chỉ trình bày fan-out on write và bị hỏi celebrity là lúng túng.
- Lưu nội dung bài vào feed của từng user.
- OFFSET pagination trên feed thay đổi liên tục.
- Ghi like trực tiếp vào bảng posts.
- Quên 2/3 user không mở app mỗi ngày → lãng phí fan-out.
**Dấu hiệu senior**: ưu tiên fan-out cho follower online; bỏ qua user không hoạt động và dựng lại khi quay lại; nói rõ ZADD idempotent giải quyết redelivery; phân biệt Post cache và feed cache; ranking là re-rank trên 300 ứng viên.
**Thời gian**: ước lượng phải chạm được con số khuếch đại ghi trong 5 phút đầu; đào sâu dành cho hybrid và cấu trúc cache.`
});
window.MOCKS.push({
  id: 'M7', caseId: 'C7', title: 'Design a chat system', level: 3,
  prompt: `"Design a messaging system like WhatsApp: one-to-one and group chat, online presence, delivery and read receipts, and messages must reach users who are offline when they come back."
Thiết kế hệ nhắn tin kiểu WhatsApp: chat 1-1 và nhóm, presence, biên nhận đã nhận và đã đọc, user offline vẫn nhận tin khi quay lại.`,
  clarify: [
    'Hỏi: Quy mô? → Đáp: 50M DAU, 40 tin mỗi người mỗi ngày.',
    'Hỏi: Nhóm tối đa bao nhiêu người? → Đáp: 500.',
    'Hỏi: Text hay media? → Đáp: text là chính, media qua object storage, chat chuyển URL.',
    'Hỏi: Lưu lịch sử bao lâu? → Đáp: tới khi user xoá.',
    'Hỏi: Nhiều thiết bị một tài khoản? → Đáp: tối đa 5, phải đồng bộ.',
    'Hỏi: Mã hoá đầu cuối bắt buộc không? → Đáp: nói sơ lược là đủ.',
    'Hỏi: Độ trễ chấp nhận? → Đáp: dưới 1 giây tới thiết bị online.'
  ],
  phases: {
    req: { checks: ['Chốt functional: 1-1, nhóm, presence, receipts, offline, multi-device, lịch sử', 'Chốt non-functional: dưới 1 s, không mất tin, thứ tự trong hội thoại, 10M kết nối', 'Hỏi kích thước nhóm và số thiết bị', 'Loại trừ gọi thoại, bot, search toàn văn'],
      hint: `Hai câu hỏi quyết định kiến trúc: kích thước nhóm (fan-out) và multi-device (cursor).
Chốt: thứ tự chỉ cần nhất quán trong một hội thoại, không cần toàn cục.` },
    est: { checks: ['2 tỷ tin/ngày ≈ 23k/s, đỉnh 70k/s', '400 GB/ngày ≈ 146 TB/năm chưa replication', '10M kết nối đồng thời → 20–50 gateway', 'Push offline ≈ 7k/s tới APNs/FCM'],
      hint: `50M × 40 = 2 tỷ; chia 86 400 ≈ 23k/s.
200 B mỗi tin → 400 GB/ngày.
Gateway 200k–500k kết nối mỗi node, ~10 KB RAM mỗi kết nối.` },
    hld: { checks: ['Sơ đồ: client → L4 LB → WS gateway → Chat service → message store; registry user→gateway; presence; Kafka → push', 'Luồng gửi: ghi store trước, đẩy sau, receipt delivered khi B ack', 'Luồng online lại: cursor last_message_id → lấy tin thiếu', 'Bảng messages partition channel_id, clustering message_id; sessions và presence trong Redis TTL'],
      hint: `Gateway chỉ giữ kết nối; logic ở Chat service stateless.
Kafka không nằm trên đường nóng gửi tin; dùng cho push offline và receipts.
Nhóm: ghi 1 lần theo channel_id, đẩy tới thành viên online.` },
    deep: { checks: ['Registry user→gateway TTL heartbeat; gateway chết → reconnect jitter, sync cursor; drain khi deploy', 'Thứ tự: Snowflake id từ Chat service vs counter theo channel; client_msg_id dedup', 'Presence: heartbeat 10 s, TTL 30 s debounce, fan-out chỉ cho người đang xem', 'Multi-device: cursor theo thiết bị, read receipt theo user; E2E sơ lược với sender key'],
      hint: `Ghi trước đẩy sau là lý do không mất tin dù gateway chết.
Thứ tự: id time-ordered đủ tốt; nếu ép strict → counter theo channel, trả giá round trip.
Presence là eventual; đừng báo offline ngay khi rớt mạng.` },
    wrap: { checks: ['Tóm tắt 4 quyết định: gateway stateless, ghi trước đẩy sau, partition theo channel, cursor theo thiết bị', 'Trả lời vì sao Cassandra, hot partition, xoá tin cho mọi người', 'Nêu metric: độ trễ end-to-end, số kết nối mỗi gateway, tỉ lệ reconnect'],
      hint: `Kết: wide-column vì ghi lớn và truy vấn theo channel; WebSocket vì hai chiều; Kafka ngoài đường nóng.
Nêu điều sẽ làm khác cho kênh broadcast triệu người (bucket theo ngày, pull).` }
  },
  followups: [
    'Why write the message to storage before pushing it to the recipient?',
    'How does the chat service know which gateway the recipient is connected to?',
    'A gateway holding 300 thousand connections crashes. What happens?',
    'How do you order messages within a group when senders are on different servers?',
    'Why partition messages by channel id and not by user id?',
    'How do you avoid presence flapping on flaky mobile networks?',
    'How do read receipts work when a user has five devices?',
    'Where would Kafka sit in this design, and where would it not?',
    'How does end-to-end encryption change your server design?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tách gateway (kết nối) khỏi Chat service (logic); ghi store trước rồi đẩy; registry user→gateway; partition theo channel với id time-ordered; cursor theo thiết bị; presence eventual có debounce; Kafka chỉ cho việc không cần dưới 1 giây.
**Bẫy thường gặp**:
- HTTP polling cho chat.
- Lưu tin theo user (nhân bản theo thành viên nhóm).
- Dùng timestamp client làm thứ tự.
- Để Kafka trên đường nóng và không giải thích được độ trễ.
- Quên multi-device, cursor theo user.
**Dấu hiệu senior**: client_msg_id dedup khi gửi lại; drain gateway khi deploy; ping/pong qua proxy idle timeout; unread count từ last_read_id thay vì đếm; biết sender key cho E2E nhóm; nói được giới hạn 500 thành viên là để fan-out còn hợp lý.
**Thời gian**: đề nặng, hãy vẽ HLD gọn trong 10 phút và dành 18 phút cho 3 điểm nóng: gateway, thứ tự, multi-device.`
});
window.MOCKS.push({
  id: 'M8', caseId: 'C8', title: 'Design a search autocomplete', level: 2,
  prompt: `"Design search autocomplete: as the user types, return the top five most popular queries matching the prefix. It has to feel instant."
Thiết kế autocomplete: khi user gõ, trả 5 truy vấn phổ biến nhất khớp prefix; phải cảm giác tức thì.`,
  clarify: [
    'Hỏi: Khớp prefix hay cả giữa chuỗi, có sửa chính tả? → Đáp: prefix; không sửa chính tả.',
    'Hỏi: Bao nhiêu gợi ý, xếp theo gì? → Đáp: 5, theo tần suất lịch sử.',
    'Hỏi: Cá nhân hoá không? → Đáp: không.',
    'Hỏi: Dữ liệu cập nhật nhanh cỡ nào? → Đáp: hằng ngày đủ; trending là điểm cộng.',
    'Hỏi: Quy mô? → Đáp: 10M DAU, 10 lần tìm, 20 ký tự trung bình.',
    'Hỏi: Chữ hoa thường, ngôn ngữ? → Đáp: chữ thường, tiếng Anh trước.',
    'Hỏi: Lọc nội dung nhạy cảm? → Đáp: có blocklist.'
  ],
  phases: {
    req: { checks: ['Chốt prefix match, top-5 theo tần suất, không cá nhân hoá', 'Non-functional: p99 dưới 100 ms, server dưới 20 ms, 100k+ QPS đỉnh', 'Dữ liệu lệch 1 ngày chấp nhận được', 'Có blocklist'],
      hint: `Hỏi loại khớp, số gợi ý, cách xếp, tần suất cập nhật, quy mô, chuẩn hoá chuỗi, lọc.
Nhấn: đây là hệ đọc cực nhiều và chấp nhận dữ liệu cũ.` },
    est: { checks: ['2 tỷ request/ngày ≈ 24k QPS, đỉnh 120k; debounce giảm nửa', '100M truy vấn/ngày, 20M khác nhau ≈ 600 MB log/ngày', 'Trie top-5 tính trước 10–30 GB, vừa RAM vài shard', '5 ký tự đầu ≈ 95% request → cache rất hiệu quả'],
      hint: `10M × 10 × 20 ký tự = 2 tỷ request. Debounce 100 ms bỏ ~50%.
Trie: 100M–500M truy vấn khác nhau × vài chục byte + top-5 mỗi node.` },
    hld: { checks: ['Sơ đồ đường đọc: client → CDN → Query service → Redis → Trie shard', 'Sơ đồ đường ghi: log → Kafka → aggregator → builder → snapshot S3 → trie server nạp', 'Trending service cửa sổ 1 giờ trộn lúc đọc', 'API GET /suggest với Cache-Control; log chỉ khi submit'],
      hint: `Tách hẳn đường đọc (snapshot trong RAM) khỏi đường ghi (offline).
Log theo submit, không theo ký tự.
Trie server nạp snapshot kiểu double buffer.` },
    deep: { checks: ['Top-k tại node vs duyệt cây con; giới hạn độ sâu lưu top-k', 'Shard map theo range prefix từ dữ liệu thực, 3 replica mỗi shard', 'Offline rebuild + lớp trending vs cập nhật tại chỗ', 'Cache 3 tầng (browser, CDN, Redis); blocklist lọc 2 lớp'],
      hint: `Prefix "a" có cây con hàng triệu node → phải tính trước top-5.
Shard theo 1 chữ cái lệch; dùng shard map a–ag, ah–az...
Trending: cửa sổ trượt 1 giờ, merge 1–2 gợi ý lúc đọc.` },
    wrap: { checks: ['Tóm tắt: trie top-k, snapshot offline, shard map, cache', 'Trả lời vì sao không ES suggester, chống spam, snapshot nạp bao lâu', 'Nêu metric chất lượng: click-through gợi ý'],
      hint: `Nói được ES completion suggester là lựa chọn hợp lý ở quy mô vừa.
Metric: tỉ lệ chọn gợi ý, vị trí được chọn, p99.` }
  },
  followups: [
    'Why precompute top five at each node instead of computing it at query time?',
    'How do you shard the trie, and why not one shard per first letter?',
    'How do you update the trie without blocking reads?',
    'A new event makes a brand new query popular right now. How fast can you surface it?',
    'Why not use Elasticsearch completion suggester?',
    'How do you prevent someone from spamming a query to push it to the top?',
    'What exactly do you log to compute popularity?',
    'How would you support Vietnamese or Japanese input?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tách đường đọc khỏi đường ghi; trie với top-5 tại node cho O(độ dài prefix); snapshot bất biến và hot swap; shard map theo range prefix; cache 3 tầng dựa trên quan sát 5 ký tự đầu chiếm 95%; trending là lớp riêng.
**Bẫy thường gặp**:
- LIKE prefix% trên DB mỗi ký tự.
- Trie không lưu top-k, duyệt cây con cho prefix ngắn.
- Ghi vào trie đang đọc.
- Đếm theo ký tự gõ thay vì theo submit.
- Quên debounce và cache phía client.
**Dấu hiệu senior**: giới hạn độ sâu lưu top-k để tiết kiệm RAM; decay theo thời gian; đếm theo user khác nhau để chống spam; blocklist áp dụng cả lúc build và lúc đọc; nói được ES suggester là lựa chọn thực dụng và khi nào tự xây.
**Thời gian**: HLD nhanh; dành thời gian cho cấu trúc dữ liệu và pipeline cập nhật.`
});
window.MOCKS.push({
  id: 'M9', caseId: 'C9', title: 'Design a video streaming platform', level: 3,
  prompt: `"Design a video sharing platform like YouTube: users upload videos, we process them, and viewers stream smoothly on any device and network. Assume five million daily active users."
Thiết kế nền tảng video kiểu YouTube: upload, xử lý, stream mượt trên mọi thiết bị và mạng; 5 triệu DAU.`,
  clarify: [
    'Hỏi: Tính năng cốt lõi? → Đáp: upload, xem, tìm cơ bản, view count, like.',
    'Hỏi: Kích thước và độ dài video? → Đáp: tối đa 1 GB, trung bình 300 MB, 10 phút.',
    'Hỏi: Tỉ lệ upload và xem? → Đáp: 10% DAU upload 1 video/ngày; mỗi DAU xem 5 video.',
    'Hỏi: Live stream? → Đáp: không.',
    'Hỏi: Thiết bị và mạng? → Đáp: từ 3G tới fiber → adaptive bitrate.',
    'Hỏi: Chi phí có là ràng buộc? → Đáp: có, CDN và storage lớn nhất.',
    'Hỏi: DRM, kiểm duyệt? → Đáp: ngoài phạm vi.'
  ],
  phases: {
    req: { checks: ['Chốt functional: upload resumable, transcoding nhiều độ phân giải, stream adaptive, metadata, view count', 'Non-functional: ready trong vài phút, start-up dưới 2 s, không mất video, chi phí kiểm soát', 'Loại trừ live, DRM, recommendation', 'Hỏi về chi phí như một ràng buộc'],
      hint: `Hỏi kích thước, tỉ lệ upload/xem, live hay VOD, thiết bị, chi phí.
Chốt: VOD, adaptive bitrate, chi phí egress là ràng buộc thiết kế.` },
    est: { checks: ['500k video/ngày, 150 TB/ngày upload, 225 TB/ngày sau transcoding ≈ 80 PB/năm', '25M lượt xem/ngày; egress ≈ 2,75 PB/ngày ≈ 250 Gbps trung bình', 'Chi phí CDN ≈ 55k USD/ngày, lớn hơn storage', 'Transcoding ≈ 17 000 core liên tục → phải song song và hàng đợi'],
      hint: `5M × 10% × 300 MB = 150 TB/ngày.
25M lượt × 10 phút × ~1,5 Mbps ≈ 110 MB mỗi lượt → 2,75 PB/ngày.
Kết luận: egress và CPU là chi phí chính.` },
    hld: { checks: ['Sơ đồ: upload presigned → S3 raw → event → orchestrator DAG → workers → S3 HLS → CDN; metadata DB; Kafka view events', 'Luồng upload multipart resumable, API không chạm byte', 'Luồng xử lý: inspect → split → encode song song → package → ready', 'Luồng xem: manifest từ metadata, segment từ CDN, view event theo lô'],
      hint: `Upload thẳng lên object storage bằng presigned URL.
Transcoding là DAG lưu trạng thái trong DB.
Player lấy master playlist → chọn rendition → segment từ CDN.` },
    deep: { checks: ['DAG chunk × rendition, task idempotent, fail cục bộ, ưu tiên, xem sớm ở 360p', 'HLS/DASH segment 4 s, master playlist, codec trade-off', 'Chi phí: CDN hit cho 5% video nóng, phân tầng storage, lazy transcoding, spot', 'Resumable multipart, dedup theo content hash, view count theo lô có chống gian lận'],
      hint: `Video 10 phút → 60 chunk × 5 rendition = 300 task 10–30 s → ready trong 1–2 phút.
Một chunk lỗi chỉ retry chunk đó.
Phân phối lượt xem lệch: 5% video chiếm phần lớn → CDN cho phần này, origin cho long tail.` },
    wrap: { checks: ['Tóm tắt: presigned upload, DAG, HLS, CDN, chi phí', 'Trả lời chunk lỗi mãi, video 4 giờ, người xem xa origin', 'Nêu metric: upload tới ready p95, CDN hit, rebuffer ratio, egress mỗi 1 000 lượt xem'],
      hint: `Kết bằng chi phí: egress là khoản phải tối ưu đầu tiên.
Nêu fair share cho video dài để không chiếm hàng đợi.` }
  },
  followups: [
    'Why upload directly to object storage instead of through your API?',
    'Describe the transcoding pipeline for a ten minute video. How long until it is watchable?',
    'One chunk fails to encode every time. What happens to the video?',
    'How does adaptive bitrate streaming actually work?',
    'What is your biggest cost and how do you reduce it?',
    'How do you make uploads resumable?',
    'How do you count views without hammering the database?',
    'A viewer in Tokyo watches a video whose origin is in Virginia. What is the experience?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: upload presigned multipart; transcoding là DAG task nhỏ idempotent với trạng thái trong DB; HLS segment ngắn qua CDN; nhận ra egress là chi phí lớn nhất và có chiến lược; view count bất đồng bộ.
**Bẫy thường gặp**:
- Upload qua API server.
- Transcoding tuần tự một task mỗi video; một lỗi hỏng cả video.
- Trả MP4 nguyên khối không adaptive.
- UPDATE view_count mỗi lượt xem.
- Không nhắc chi phí dù đề nói rõ.
**Dấu hiệu senior**: cho xem sớm ở rendition thấp; lazy transcoding rendition cao cho long tail; spot instance cho task idempotent; signed URL chống hotlink; dedup theo content hash; fair share hàng đợi theo video dài; metric upload-to-ready và rebuffer ratio.
**Liên hệ công việc**: pipeline enrichment dạng DAG với bước lỗi làm hỏng cả batch là câu chuyện tốt khi nói về cô lập lỗi theo task.`
});
window.MOCKS.push({
  id: 'M10', caseId: 'C10', title: 'Design a cloud file storage', level: 3,
  prompt: `"Design a file storage and sync service like Dropbox: upload from any device, sync across devices, share with others, and keep version history."
Thiết kế dịch vụ lưu trữ và đồng bộ file kiểu Dropbox: upload từ mọi thiết bị, đồng bộ giữa thiết bị, chia sẻ, giữ lịch sử phiên bản.`,
  clarify: [
    'Hỏi: Kích thước file tối đa, phân bố? → Đáp: tới 10 GB; đa số dưới 1 MB.',
    'Hỏi: Quy mô? → Đáp: 50M user, 10M DAU, 10 GB mỗi người.',
    'Hỏi: Đồng bộ nhanh cỡ nào? → Đáp: vài giây.',
    'Hỏi: Hai thiết bị sửa cùng file khi offline? → Đáp: không mất dữ liệu, conflict đơn giản là được.',
    'Hỏi: Lịch sử bao lâu? → Đáp: 30 ngày.',
    'Hỏi: Chia sẻ mức nào? → Đáp: file và thư mục, quyền view/edit, link công khai.',
    'Hỏi: Mã hoá? → Đáp: at rest và in transit, không end-to-end.'
  ],
  phases: {
    req: { checks: ['Chốt functional: upload, sync, version 30 ngày, chia sẻ, offline', 'Non-functional: metadata strong consistency, không mất dữ liệu, sync vài giây, tiết kiệm băng thông', 'Hỏi về conflict và mã hoá (ảnh hưởng dedup)', 'Loại trừ cộng tác realtime, search nội dung'],
      hint: `Câu hỏi then chốt: metadata cần strong consistency không (có), và mã hoá kiểu gì (quyết định dedup được hay không).
Chốt: không mất dữ liệu quan trọng hơn tốc độ.` },
    est: { checks: ['20M file/ngày ≈ 230/s; 10 TB/ngày dữ liệu mới', '50 PB logic, ~35 PB sau dedup', 'Metadata ~25 TB → shard Postgres theo namespace', '12,5 tỷ block 4 MB, bảng block index ~1,25 TB; 10M kết nối long poll'],
      hint: `50M × 10 GB × 10% = 50 PB. 50 PB / 4 MB = 12,5 tỷ block.
50M user × 1 000 file × 500 B = 25 TB metadata.
Thông báo chỉ ~700/s nhưng 10M kết nối chờ.` },
    hld: { checks: ['Sơ đồ: client → Block service → S3; client → Metadata API → Postgres shard + Redis → queue → Notification long poll → thiết bị khác', 'Luồng upload: chunk → check hash → upload block thiếu → commit version', 'Luồng sync: notify → GET /delta?cursor → tải block thiếu', 'Bảng files, file_versions, blocks ref_count, changes cursor, shares'],
      hint: `Block service nhận byte; Metadata API chỉ nhận metadata.
Commit version trong transaction với kiểm tra parent_version.
Notification chỉ trả "có thay đổi", client tự lấy delta.` },
    deep: { checks: ['Block 4 MB cố định vs content-defined vs delta rsync; dedup và mã hoá hệ thống', 'Metadata transaction, optimistic concurrency, shard theo namespace, đọc sync từ primary', 'Long polling vs polling vs WebSocket; payload nhỏ', 'Conflict → conflicted copy; offline queue; GC theo ref_count và grace period; kiểm quyền mọi block'],
      hint: `Chèn 1 byte đầu file làm dịch mọi block cố định → nêu CDC như nâng cao.
409 khi parent_version cũ → bản sao conflicted, không ghi đè.
Không tin hash từ client; kiểm quyền qua version chứa block.` },
    wrap: { checks: ['Tóm tắt: block + hash, metadata strong, long poll + cursor, conflicted copy, GC', 'Trả lời dedup toàn hệ rủi ro gì, file 10 GB đứt, đổi tên thư mục lớn', 'Nêu metric: commit tới notify p95, tỉ lệ dedup, số conflict/ngày'],
      hint: `Kết bằng câu: không mất dữ liệu của ai là nguyên tắc, tốc độ là tối ưu.
Nêu điều sẽ làm khác nếu cần cộng tác realtime (CRDT/OT).` }
  },
  followups: [
    'Why split files into blocks instead of storing whole files?',
    'Two devices edit the same file offline. What happens when both come online?',
    'Why does metadata need strong consistency while the blocks do not?',
    'Long polling or WebSocket for sync notifications, and why?',
    'What are the risks of system-wide deduplication?',
    'When is it safe to physically delete a block?',
    'A 10 GB upload drops at 9 GB. What does the client do?',
    'How do you rename a folder with one hundred thousand files?',
    'How do you make sure a shared link does not leak other blocks?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: block 4 MB theo hash với dedup, delta và resume; metadata trong Postgres transaction với optimistic concurrency; long polling + cursor delta với payload nhỏ; conflict tạo bản sao không ghi đè; GC theo ref_count và grace period; kiểm quyền qua version.
**Bẫy thường gặp**:
- Lưu file nguyên khối.
- Metadata eventual → cây thư mục khác nhau giữa thiết bị.
- Polling vài giây từ hàng triệu client.
- Xoá block ngay khi version bị xoá.
- Tin hash do client gửi.
**Dấu hiệu senior**: nói được dedup toàn hệ lộ "block đã tồn tại"; mã hoá hệ thống để dedup hoạt động; path theo parent_id để đổi tên rẻ; shard theo namespace và thư mục chia sẻ là namespace riêng; đọc đường sync từ primary; nêu CRDT/OT là bài khác.
**Liên hệ công việc**: nếu từng gặp ghi đè kết quả mới bằng kết quả cũ do thiếu version check, kể ngắn khi bàn về optimistic concurrency.`
});
