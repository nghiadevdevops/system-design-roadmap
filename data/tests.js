/* ===== tests.js — 5 đề test kiến thức bấm giờ (KTESTS) + 90 câu hỏi nhanh trả lời miệng (ORAL) =====
   KTESTS: mỗi đề 30 câu trắc nghiệm, topic trải đều, độ khó tăng dần, >= 8 câu tình huống.
   ORAL: 18 topic x 5 câu, level 1-3, trả lời miệng 2 phút, có câu EN mở đầu gợi ý. */
window.KTESTS = [
{ id: 'KT0', title: 'Kiểm tra đầu vào (tuần 1)', minutes: 30, qs: [
  { topic: 'net', t: 'mc', q: 'Khi gõ https://example.com vào trình duyệt và nhấn Enter, bước nào xảy ra TRƯỚC TIÊN (bỏ qua cache)?',
    o: ['TCP 3-way handshake tới server', 'TLS handshake trao đổi chứng chỉ', 'Phân giải DNS tên miền thành địa chỉ IP', 'Gửi HTTP GET / tới server'], a: 2,
    why: 'Chưa biết IP thì không mở được TCP; DNS luôn đi trước, sau đó mới TCP, TLS rồi HTTP.' },
  { topic: 'os', t: 'mc', q: 'Các thread trong cùng một process chia sẻ với nhau thứ gì?',
    o: ['Heap và không gian địa chỉ bộ nhớ (biến toàn cục, file descriptor)', 'Stack gọi hàm của nhau', 'Program counter (con trỏ lệnh)', 'Tập thanh ghi CPU (registers)'], a: 0,
    why: 'Thread chia sẻ địa chỉ bộ nhớ và tài nguyên của process; stack, PC và thanh ghi là riêng từng thread.' },
  { topic: 'db', t: 'mc', q: 'Thêm index B-tree lên cột hay dùng trong WHERE giúp đọc nhanh hơn. Trả giá bằng gì?',
    o: ['Đọc chậm hơn vì phải đi qua thêm một lớp', 'Mất tính ACID của bảng đó', 'Phải tắt replication trong lúc tạo index', 'Ghi (INSERT/UPDATE/DELETE) chậm hơn và tốn thêm dung lượng lưu trữ'], a: 3,
    why: 'Mỗi lần ghi phải cập nhật thêm cây index; index cũng chiếm đĩa và RAM cache. Đó là trade-off kinh điển đọc nhanh - ghi chậm.' },
  { topic: 'cache', t: 'mc', q: 'Với pattern cache-aside, khi ứng dụng đọc bị cache miss thì làm gì?',
    o: ['Trả lỗi 404 cho client vì dữ liệu chưa có trong cache', 'Ứng dụng đọc từ DB, tự ghi kết quả vào cache rồi trả về', 'Chờ cache tự nạp dữ liệu từ DB', 'Ghi dữ liệu vào cache trước rồi DB sau'], a: 1,
    why: 'Cache-aside: ứng dụng tự quản lý cache, miss thì đọc DB và điền vào cache; cache không tự biết DB (khác read-through).' },
  { topic: 'api', t: 'mc', q: 'Client gọi quá giới hạn rate limit của API. Mã HTTP chuẩn để trả về là gì?',
    o: ['403 Forbidden', '429 Too Many Requests', '503 Service Unavailable', '409 Conflict'], a: 1,
    why: '429 dành riêng cho rate limit, thường kèm header Retry-After để client biết khi nào thử lại.' },
  { topic: 'queue', t: 'mc', q: 'Message queue đặt giữa hai service giải quyết vấn đề chính nào?',
    o: ['Làm request của client nhanh hơn nhờ xử lý đồng bộ song song', 'Đảm bảo strong consistency giữa các service', 'Thay thế database cho dữ liệu tạm thời', 'Tách rời producer khỏi consumer và hấp thụ đỉnh tải (buffer)'], a: 3,
    why: 'Queue giúp decouple (consumer chết thì producer vẫn chạy) và làm bộ đệm khi tải đột biến; nó không tạo consistency hay thay DB.' },
  { topic: 'scale', t: 'mc', q: 'Muốn scale ngang (thêm nhiều server) ở tầng ứng dụng, điều kiện quan trọng nhất là gì?',
    o: ['Ứng dụng stateless; session, file tạm đặt ở store dùng chung', 'Mọi server phải cùng cấu hình phần cứng', 'Phải dùng ngôn ngữ biên dịch để tiết kiệm RAM', 'Phải bật sticky session ở load balancer'], a: 0,
    why: 'Nếu server giữ state riêng thì không thể thêm/bớt server tự do. Stateless là tiền đề của horizontal scaling.' },
  { topic: 'storage', t: 'mc', q: 'Object storage (S3, MinIO) phù hợp nhất với loại dữ liệu nào?',
    o: ['Dữ liệu quan hệ cần JOIN và transaction', 'Session người dùng cần đọc ghi liên tục độ trễ thấp', 'File blob lớn ghi một lần đọc nhiều (file SBOM gốc, ảnh, video)', 'Hàng đợi message giữa các service'], a: 2,
    why: 'Object storage rẻ, bền, scale gần vô hạn nhưng không sửa được một phần object và độ trễ cao hơn đĩa cục bộ.' },
  { topic: 'security', t: 'mc', q: 'Lưu mật khẩu người dùng trong DB nên dùng cách nào?',
    o: ['bcrypt hoặc argon2 (hash chậm, có salt riêng từng mật khẩu)', 'SHA-256 không salt vì nhanh và được coi là an toàn', 'MD5 kèm một salt cố định cho toàn hệ thống', 'AES-256 với khoá lưu trong file config'], a: 0,
    why: 'Hash chậm có salt chống brute-force và rainbow table; SHA/MD5 quá nhanh, còn mã hoá đối xứng thì giải mã được nếu lộ khoá.' },
  { topic: 'observability', t: 'mc', q: 'Muốn vẽ biểu đồ p99 latency của từng endpoint theo thời gian, dùng loại tín hiệu nào?',
    o: ['Log có cấu trúc rồi grep theo endpoint', 'Distributed trace của từng request', 'Metrics dạng histogram gắn label endpoint', 'Heap profile lấy định kỳ'], a: 2,
    why: 'Histogram metrics tổng hợp rẻ, truy vấn percentile theo thời gian; log/trace quá đắt để tính p99 liên tục.' },
  { topic: 'design', t: 'mc', q: 'Hệ thống nhận 10 triệu request/ngày. QPS trung bình xấp xỉ bao nhiêu (1 ngày ≈ 10^5 giây)?',
    o: ['~10 RPS', '~100 RPS', '~1 000 RPS', '~10 000 RPS'], a: 1,
    why: '10^7 / 10^5 = 100. Đỉnh thường gấp 2-5 lần trung bình, nên thiết kế cho ~300-500 RPS.' },
  { topic: 'consistency', t: 'mc', q: 'Theo định lý CAP, khi xảy ra network partition hệ thống phân tán buộc phải chọn giữa?',
    o: ['Consistency và Durability', 'Availability và Partition tolerance', 'Latency và Throughput', 'Consistency và Availability'], a: 3,
    why: 'Partition là điều không tránh được; lúc đó hoặc từ chối phục vụ (giữ C) hoặc trả dữ liệu có thể cũ (giữ A).' },
  { topic: 'go', t: 'mc', q: 'Goroutine khác OS thread ở điểm cốt lõi nào?',
    o: ['Goroutine chính là OS thread được Go đặt tên khác', 'Goroutine chỉ chạy trên một OS thread nên không bao giờ song song', 'Goroutine có stack cố định 1 MB như thread', 'Goroutine nhẹ (stack khởi đầu vài KB, co giãn), runtime Go lập lịch M:N lên ít OS thread'], a: 3,
    why: 'Nhờ stack nhỏ co giãn và scheduler trong user-space, một process Go có thể chạy hàng trăm nghìn goroutine.' },
  { topic: 'concurrency', t: 'mc', q: 'Hai goroutine cùng thực hiện counter++ trên một biến int không có khoá. Kết quả?',
    o: ['Luôn đúng vì phép cộng số nguyên là atomic trên CPU 64-bit', 'Có thể mất cập nhật (lost update), kết quả không xác định', 'Chương trình panic ngay lập tức', 'Go runtime tự thêm khoá nên an toàn'], a: 1,
    why: 'counter++ là đọc-sửa-ghi 3 bước, hai goroutine xen kẽ sẽ ghi đè nhau. Dùng sync/atomic hoặc Mutex; chạy go test -race để phát hiện.' },
  { topic: 'cloud', t: 'mc', q: 'Serverless function (AWS Lambda) phù hợp nhất với loại tải nào?',
    o: ['Job xử lý liên tục hàng giờ với kết nối DB bền', 'Server WebSocket giữ hàng nghìn kết nối lâu dài', 'Tác vụ ngắn, event-driven, tải bùng nổ không đều, stateless', 'Cơ sở dữ liệu in-memory'], a: 2,
    why: 'Lambda tính tiền theo thời gian chạy, có giới hạn thời gian và cold start; hợp với burst ngắn, không hợp job dài hay kết nối bền.' },
  { topic: 'data', t: 'mc', q: 'Báo cáo tổng hợp hàng triệu dòng theo tháng (GROUP BY lớn) nên chạy ở đâu?',
    o: ['Trên read replica hoặc kho dữ liệu dạng cột (OLAP) tách khỏi primary', 'Trực tiếp trên primary OLTP vì dữ liệu mới nhất', 'Trong Redis để nhanh', 'Trong message queue để tính dần'], a: 0,
    why: 'Query quét lớn làm nghẽn CPU/IO của primary đang phục vụ giao dịch; tách OLAP khỏi OLTP là nguyên tắc cơ bản.' },
  { topic: 'realtime', t: 'mc', q: 'Ứng dụng chat cần server đẩy tin nhắn tới client ngay lập tức với hàng trăm nghìn người online. Cách nào hiệu quả nhất?',
    o: ['Short polling mỗi 1 giây', 'Long polling', 'WebSocket (kết nối hai chiều bền)', 'gRPC unary call cho mỗi tin nhắn'], a: 2,
    why: 'WebSocket giữ một kết nối, server push tức thì, chi phí mỗi tin nhắn nhỏ; polling tốn request rỗng và trễ.' },
  { topic: 'search', t: 'mc', q: 'Tìm kiếm full-text theo từ khoá trong hàng triệu tài liệu dùng cấu trúc dữ liệu nào?',
    o: ['B-tree trên cột text', 'Inverted index (từ → danh sách tài liệu chứa từ đó)', 'Hash map theo id tài liệu', 'Bloom filter trên nội dung'], a: 1,
    why: 'Inverted index tra từ ra danh sách tài liệu gần như tức thì thay vì quét từng tài liệu; là lõi của Elasticsearch/Lucene.' },
  { topic: 'net', t: 'mc', q: 'Load balancer cần route /api/v1 sang cụm A và /static sang cụm B. Cần loại LB nào?',
    o: ['L4 (TCP) vì nhanh hơn', 'DNS round-robin', 'Anycast', 'L7 (HTTP) vì phải đọc được URL path'], a: 3,
    why: 'L4 chỉ thấy IP/port; muốn route theo path, header, cookie phải lên L7 (nginx, ALB, Envoy).' },
  { topic: 'os', t: 'mc', q: 'Service đột ngột bị kill, log không có panic; docker inspect báo OOMKilled=false nhưng dmesg của host có dòng Out of memory: Killed process. Nguyên nhân khả dĩ nhất?',
    o: ['OOM killer cấp host (global) do container không đặt memory limit, nên cờ OOMKilled của cgroup không bật', 'Kernel panic của host', 'Orchestrator dừng container vì health check fail', 'Đĩa đầy làm process thoát'], a: 0,
    why: 'Không có memory limit thì không có cgroup OOM; kernel chọn giết process lớn nhất trên host và Docker không ghi nhận. Luôn đặt mem_limit.' },
  { topic: 'db', t: 'mc', q: 'Query WHERE status = pending ORDER BY created_at LIMIT 100 trên bảng 50 triệu dòng (chỉ 0,1% là pending) chạy 2 phút. Bước xử lý đầu tiên?',
    o: ['Chạy EXPLAIN ANALYZE, rồi tạo partial index WHERE status = pending (kèm created_at)', 'Tăng RAM và shared_buffers cho DB', 'Chuyển bảng sang NoSQL', 'Tăng statement_timeout để query chạy xong'], a: 0,
    why: 'Phải nhìn plan trước; partial index trên tập 0,1% nhỏ hơn hàng trăm lần index thường và biến phút thành mili giây.' },
  { topic: 'cache', t: 'mc', q: 'Ngay sau khi deploy, cache hit rate rơi từ 95% xuống 5% và DB quá tải. Nguyên nhân khả dĩ nhất?',
    o: ['Redis hết RAM nên evict dữ liệu', 'Deploy đổi format cache key hoặc restart Redis làm cache lạnh, mọi request miss dồn xuống DB', 'DB bị mất index sau deploy', 'Load balancer đổi thuật toán phân tải'], a: 1,
    why: 'Thay đổi key prefix/serialization hoặc cold cache là thủ phạm phổ biến; cần warm-up hoặc deploy dần, không xoá cache cùng lúc deploy.' },
  { topic: 'queue', t: 'mc', q: 'Mọi cron job dùng chung một publisher RabbitMQ bỗng im lặng nhiều ngày sau khi container broker bị recreate; không có lỗi trong log. Nguyên nhân khả dĩ nhất?',
    o: ['Queue đầy nên broker từ chối message', 'Consumer prefetch quá cao', 'Message hết TTL trước khi consumer nhận', 'Publisher singleton giữ connection đã chết, không reconnect, và lỗi publish bị nuốt'], a: 3,
    why: 'Connection AMQP không tự hồi khi broker đổi; nếu code nuốt lỗi publish thì mọi thứ chết im. Cần reconnect + alert theo số message publish thành công.' },
  { topic: 'api', t: 'mc', q: 'Client gửi POST /payments bị timeout rồi retry. Cách chuẩn để tránh tính tiền hai lần?',
    o: ['Chuyển sang PUT vì PUT idempotent', 'Server dedupe theo cặp (user, số tiền) trong 1 phút', 'Client gửi header Idempotency-Key; server lưu kết quả theo key và trả lại kết quả cũ khi retry', 'Client không retry, báo lỗi để người dùng tự thử lại'], a: 2,
    why: 'Idempotency key là chuẩn của Stripe/PSP: cùng key thì cùng kết quả. Dedupe theo số tiền sẽ chặn nhầm hai giao dịch hợp lệ.' },
  { topic: 'scale', t: 'mc', q: 'DB primary ghim 100% CPU dù mọi read đã sang replica; ghi 5 000 lần/giây dồn vào một bảng nóng. Hướng xử lý hợp lý?',
    o: ['Thêm read replica', 'Shard theo key (ví dụ tenant_id) và gộp batch write', 'Tăng connection pool của ứng dụng', 'Bật synchronous replication'], a: 1,
    why: 'Replica không giảm tải ghi; chỉ sharding (chia ghi ra nhiều primary) hoặc giảm số lần ghi (batch) mới giải quyết.' },
  { topic: 'consistency', t: 'mc', q: 'User PUT đổi avatar thành công, nhưng GET /me ngay sau đó trả URL cũ trong 1-2 giây (không qua CDN, không cache ứng dụng). Nguyên nhân?',
    o: ['Đọc từ read replica async đang có replication lag', 'Browser cache HTML trang profile', 'DB rollback transaction do deadlock', 'CDN cache URL ảnh'], a: 0,
    why: 'Đây là vi phạm read-your-own-writes do đọc từ replica; fix bằng cách route đọc của user vừa ghi về primary trong vài giây.' },
  { topic: 'security', t: 'mc', q: 'Tenant A thấy license declared của một component mang giá trị do tenant B nhập, vì bảng component dùng chung ghi kiểu first-writer-wins. Đây là lỗi gì và sửa theo hướng nào?',
    o: ['Lỗi cache stale, invalidate cache là đủ', 'Lỗi encoding ký tự khi lưu', 'Thiếu cách ly dữ liệu giữa tenant; dữ liệu dùng chung phải có overlay/scope theo tenant', 'Thiếu rate limit cho tenant'], a: 2,
    why: 'Dữ liệu tenant nhập mà tenant khác nhìn thấy là data leak trong multi-tenant; phải tách lớp dữ liệu chung (fact) khỏi lớp per-tenant (overlay).' },
  { topic: 'observability', t: 'mc', q: 'Enrichment pending kẹt hàng giờ; log của Lambda chỉ in connection refused 127.0.0.1:6379 bắt đầu từ sau một lần redeploy. Nguyên nhân khả dĩ nhất?',
    o: ['Redis sập hoàn toàn', 'Redis đạt giới hạn maxclients', 'Security group chặn cổng 6379', 'Lambda mất biến môi trường REDIS_HOST sau redeploy nên code fallback về localhost'], a: 3,
    why: 'Địa chỉ 127.0.0.1 trong log là dấu hiệu config default; code nên fail-fast khi thiếu env thay vì fallback âm thầm.' },
  { topic: 'design', t: 'mc', q: 'Lưu 10 triệu file SBOM mỗi năm, trung bình 2 MB một file. Dung lượng cần mỗi năm?',
    o: ['2 TB', '200 TB', '20 PB', '20 TB'], a: 3,
    why: '10^7 × 2 × 10^6 byte = 2 × 10^13 byte = 20 TB; cộng thêm replica/erasure coding khi ước lượng chi phí.' },
  { topic: 'db', t: 'mc', q: 'Sau migration thêm cột vào DB A, API đọc dữ liệu đó qua Postgres FDW từ DB B báo 500 column does not exist dù cột đã tồn tại ở A. Nguyên nhân?',
    o: ['Replication lag giữa hai DB', 'Thiếu quyền SELECT trên cột mới', 'Foreign table lưu cố định danh sách cột lúc IMPORT FOREIGN SCHEMA; phải ALTER FOREIGN TABLE hoặc re-import', 'Plan cache của Postgres chưa invalidate'], a: 2,
    why: 'FDW không tự đồng bộ schema remote; migration phải kèm bước cập nhật foreign table ở mọi DB tiêu thụ.' }
]},
{ id: 'KT1', title: 'Checkpoint nền tảng (tuần 5)', minutes: 30, qs: [
  { topic: 'net', t: 'mc', q: 'Với HTTPS dùng TLS 1.3, từ lúc mở kết nối mới đến khi gửi được HTTP request đầu tiên tốn bao nhiêu RTT (không tính DNS, không dùng 0-RTT)?',
    o: ['1 RTT', '2 RTT (1 cho TCP handshake, 1 cho TLS 1.3)', '3 RTT', '4 RTT'], a: 1,
    why: 'TCP cần 1 RTT, TLS 1.3 cần 1 RTT (TLS 1.2 cần 2). Vì vậy keep-alive và connection reuse tiết kiệm rất nhiều ở độ trễ liên lục địa ~150 ms.' },
  { topic: 'os', t: 'mc', q: 'Vì sao một server tạo hàng chục nghìn OS thread để xử lý request lại làm throughput giảm?',
    o: ['Mỗi thread cần một CPU core riêng', 'OS giới hạn cứng 1 024 thread', 'GC phải quét nhiều stack hơn', 'Chi phí context switch, cache miss và RAM cho stack tăng; CPU tốn thời gian chuyển đổi hơn làm việc thật'], a: 3,
    why: 'Mỗi thread tốn ~1-8 MB stack và mỗi context switch tốn vài micro giây cộng mất cache; đó là lý do event loop và goroutine (M:N) ra đời.' },
  { topic: 'db', t: 'mc', q: 'Transaction T1 đọc cùng một dòng hai lần và thấy giá trị khác nhau vì T2 đã commit ở giữa. Hiện tượng này tên gì?',
    o: ['Non-repeatable read', 'Dirty read', 'Phantom read', 'Lost update'], a: 0,
    why: 'Dirty read là đọc dữ liệu chưa commit; phantom là tập dòng đổi (thêm/bớt) khi query lại; non-repeatable là cùng dòng mà giá trị đổi.' },
  { topic: 'api', t: 'mc', q: 'Khác biệt đúng giữa PUT và PATCH trong REST?',
    o: ['PUT chỉ dùng để tạo mới, PATCH chỉ để cập nhật', 'PUT không idempotent còn PATCH idempotent', 'PUT thay thế toàn bộ resource và idempotent; PATCH cập nhật một phần, không nhất thiết idempotent', 'PUT và PATCH tương đương, chỉ khác tên'], a: 2,
    why: 'Gửi lại PUT nhiều lần cho cùng kết quả; PATCH kiểu tăng thêm 1 thì không. Thiết kế PATCH idempotent khi có thể.' },
  { topic: 'cache', t: 'mc', q: 'Vì sao nên cộng thêm jitter ngẫu nhiên vào TTL của các key cache?',
    o: ['Tránh nhiều key hết hạn cùng lúc rồi cùng miss dồn tải xuống DB (cache avalanche)', 'Giảm RAM Redis sử dụng', 'Tăng hit rate', 'Chống hot key'], a: 0,
    why: 'Key nạp cùng đợt (warm-up, deploy) sẽ hết hạn cùng lúc; jitter 10-20% trải đều thời điểm hết hạn.' },
  { topic: 'queue', t: 'mc', q: 'Broker giao message theo ngữ nghĩa at-least-once. Consumer bắt buộc phải làm gì?',
    o: ['Dùng auto-ack để không nhận lại message', 'Tăng prefetch để nhận nhanh hơn', 'Xử lý idempotent: dedupe theo message id hoặc business key', 'Bật chế độ exactly-once của broker là đủ'], a: 2,
    why: 'At-least-once nghĩa là có thể nhận trùng (sau retry, redelivery); exactly-once end-to-end chỉ đạt được khi consumer idempotent.' },
  { topic: 'scale', t: 'mc', q: 'Sticky session ở load balancer giải quyết gì và trả giá bằng gì?',
    o: ['Tăng throughput nhờ tận dụng cache CPU', 'Đảm bảo strong consistency giữa các node', 'Cho phép scale ngang không giới hạn', 'Giữ session trong bộ nhớ một node; trả giá bằng phân tải lệch và mất session khi node đó chết'], a: 3,
    why: 'Sticky session là cách vá cho app stateful; giải pháp bền là đưa session ra Redis/JWT để mọi node phục vụ được.' },
  { topic: 'net', t: 'mc', q: 'Đổi IP của server nhưng một số client vẫn gọi IP cũ nhiều giờ sau đó. Nguyên nhân khả dĩ nhất?',
    o: ['ARP cache ở switch', 'DNS TTL dài, bản ghi cũ còn cache ở resolver và client', 'BGP chưa hội tụ', 'Load balancer giữ sticky session'], a: 1,
    why: 'Trước khi đổi IP nên hạ TTL xuống 60 s vài ngày trước; đó là lý do blue-green thường dùng LB thay vì đổi DNS.' },
  { topic: 'os', t: 'mc', q: 'Service báo lỗi too many open files khi tải cao. Bước xử lý đầu tiên?',
    o: ['Tăng RAM container', 'Tăng số CPU', 'Restart Redis', 'Kiểm tra fd leak (lsof, /proc/PID/fd), thường do không đóng response body hoặc connection, rồi xem ulimit'], a: 3,
    why: 'Tăng ulimit chỉ trì hoãn; phải tìm chỗ leak (defer resp.Body.Close(), đóng file, pool connection) vì fd tăng theo thời gian là dấu hiệu leak.' },
  { topic: 'db', t: 'mc', q: 'App có 50 pod, mỗi pod pool 20 connection, Postgres max_connections = 200. Lỗi too many clients xuất hiện. Hướng xử lý hợp lý nhất?',
    o: ['Đặt connection pooler (PgBouncer) trước DB và giảm pool size mỗi pod', 'Tăng max_connections lên 2 000', 'Chuyển bớt kết nối sang replica', 'Tắt SSL để kết nối nhẹ hơn'], a: 0,
    why: 'Mỗi connection Postgres là một process tốn vài MB RAM; 2 000 connection làm DB chậm hơn chứ không nhanh hơn. Pooler gom hàng nghìn client vào vài chục connection thật.' },
  { topic: 'api', t: 'mc', q: 'Vì sao keyset (cursor) pagination tốt hơn OFFSET ở các trang sâu?',
    o: ['OFFSET không dùng được index', 'OFFSET phải quét và bỏ N dòng đầu nên O(N); keyset dùng index seek từ giá trị cuối trang trước', 'Keyset cho phép nhảy tới trang bất kỳ', 'Keyset không cần index'], a: 1,
    why: 'OFFSET 1 000 000 đọc 1 triệu dòng rồi vứt. Keyset dùng WHERE (created_at, id) > (last_created_at, last_id) nên trang nào cũng nhanh như nhau.' },
  { topic: 'cache', t: 'mc', q: 'Chiến lược cache nào có rủi ro mất dữ liệu nếu node cache chết trước khi kịp ghi xuống DB?',
    o: ['Cache-aside', 'Write-through', 'Write-back (write-behind)', 'Read-through'], a: 2,
    why: 'Write-back ghi cache trước, DB sau theo lô; nhanh nhưng dữ liệu nằm ở cache là nơi không bền.' },
  { topic: 'queue', t: 'mc', q: 'Một message lỗi (poison message) làm consumer crash, broker requeue, consumer crash tiếp, chặn mọi message phía sau. Giải pháp chuẩn?',
    o: ['Tăng số consumer', 'Tắt ack để message không bị requeue', 'Giới hạn số lần retry rồi chuyển message sang dead-letter queue (DLQ)', 'Xoá queue và tạo lại'], a: 2,
    why: 'DLQ cô lập message hỏng để xử lý tay sau, hàng đợi chính tiếp tục chạy; kèm header đếm số lần retry.' },
  { topic: 'scale', t: 'mc', q: 'Cache cluster 4 node phân phối key theo hash(key) mod N. Thêm node thứ 5 thì xấp xỉ bao nhiêu phần trăm key bị đổi vị trí?',
    o: ['~20%', '~80%', '~50%', '100%'], a: 1,
    why: 'Với mod N, hầu hết key đổi node (N/(N+1) = 4/5). Consistent hashing chỉ di chuyển ~1/(N+1) = 20% key.' },
  { topic: 'consistency', t: 'mc', q: 'Primary-replica replication async. Kỹ thuật đơn giản nhất để user vừa ghi xong đọc lại thấy ngay dữ liệu của mình (read-your-writes)?',
    o: ['Route đọc của user vừa ghi về primary trong một khoảng ngắn (hoặc chờ replica đạt LSN của lần ghi)', 'Bật synchronous replication toàn bộ', 'Tăng TTL cache', 'Dùng 2PC giữa primary và replica'], a: 0,
    why: 'Chỉ cần đảm bảo cho chính user đó, không cần toàn hệ thống đồng bộ; sync replication đánh đổi latency cho mọi request.' },
  { topic: 'net', t: 'mc', q: 'Service Go gọi API ngoài 1 000 lần/giây; netstat thấy hàng chục nghìn socket TIME_WAIT và latency cao. Nguyên nhân khả dĩ nhất?',
    o: ['DNS resolve chậm', 'MTU không khớp', 'Server từ chối keep-alive', 'Không tái sử dụng kết nối: tạo http.Transport/Client mới mỗi request, hoặc không đọc hết và đóng body'], a: 3,
    why: 'Mỗi request mở TCP+TLS mới tốn 2 RTT và để lại TIME_WAIT. Dùng một http.Client dùng chung, io.Copy(io.Discard, body) rồi Close để trả connection về pool.' },
  { topic: 'os', t: 'mc', q: 'Gọi write() ghi file trả về rất nhanh, nhưng mất điện ngay sau đó thì dữ liệu vẫn có thể mất. Vì sao?',
    o: ['Disk ghi theo sector nên phải đợi đủ sector', 'Dữ liệu mới nằm trong page cache của OS, chưa fsync xuống đĩa', 'Filesystem journaling trì hoãn', 'Do dữ liệu được nén trước khi ghi'], a: 1,
    why: 'OS gom write vào page cache rồi flush sau; DB gọi fsync trên WAL để đảm bảo durability, và đó là lý do commit tốn thời gian.' },
  { topic: 'db', t: 'mc', q: 'Hai transaction cùng UPDATE hai dòng theo thứ tự ngược nhau và Postgres báo deadlock detected. Cách phòng ngừa chuẩn?',
    o: ['Luôn cập nhật các dòng theo một thứ tự khoá cố định (ví dụ sort theo id) và giữ transaction ngắn', 'Tăng deadlock_timeout', 'Chuyển sang isolation SERIALIZABLE', 'Tắt autocommit'], a: 0,
    why: 'Deadlock xảy ra khi thứ tự lấy khoá chéo nhau; thống nhất thứ tự thì không thể tạo vòng chờ. Postgres chỉ phát hiện và huỷ, không phòng được.' },
  { topic: 'api', t: 'mc', q: 'Token bucket khác fixed window counter ở điểm nào khi làm rate limit?',
    o: ['Token bucket chặn hoàn toàn burst', 'Fixed window chính xác hơn ở biên cửa sổ', 'Token bucket cần đồng hồ đồng bộ toàn cục', 'Token bucket cho phép burst có kiểm soát (theo dung lượng bucket) và không bị gấp đôi lưu lượng ở biên cửa sổ'], a: 3,
    why: 'Fixed window cho phép 2× limit nếu burst rơi vào cuối cửa sổ này và đầu cửa sổ sau; token bucket nạp đều nên không có lỗ hổng đó.' },
  { topic: 'cache', t: 'mc', q: 'Một key (bảng xếp hạng toàn cục) nhận 200 000 read/giây làm một shard Redis quá tải trong khi các shard khác rảnh. Giải pháp?',
    o: ['Thêm shard Redis', 'Tăng TTL của key', 'Cache cục bộ trong process (TTL ngắn vài giây) và nhân bản key sang nhiều shard bằng hậu tố ngẫu nhiên', 'Chuyển key sang Postgres'], a: 2,
    why: 'Hot key nằm trên một shard nên thêm shard không giúp; phải chia tải key đó ra (replicate) hoặc chặn trước khi tới Redis (local cache).' },
  { topic: 'queue', t: 'mc', q: 'Cần xử lý các event của cùng một tenant theo đúng thứ tự nhưng vẫn scale nhiều consumer. Cách làm?',
    o: ['Dùng một consumer duy nhất cho toàn hệ thống', 'Sắp xếp lại theo timestamp ở consumer', 'Tăng prefetch', 'Partition (hoặc queue) theo tenant_id, mỗi partition chỉ một consumer tại một thời điểm'], a: 3,
    why: 'Ordering chỉ đảm bảo được trong một partition; chọn partition key là đơn vị cần thứ tự rồi scale theo số partition.' },
  { topic: 'scale', t: 'mc', q: 'Backend gồm các node mạnh yếu khác nhau và request dài ngắn khác nhau. Thuật toán LB nào phù hợp hơn round-robin?',
    o: ['Random', 'IP hash', 'Least connections (có weight theo năng lực node)', 'Round-robin thuần'], a: 2,
    why: 'Least connections đưa request mới tới node đang ít việc nhất, tự thích nghi với request dài và node yếu; round-robin đếm số lượng mà không nhìn tải thật.' },
  { topic: 'db', t: 'mc', q: 'Bảng 9,6 triệu dòng chỉ có index khoá chính; 238 job đánh giá liên tục chạy COUNT có điều kiện lọc trên bảng này; CPU DB ghim 100%, 55% request trả 500. Bước xử lý đầu tiên?',
    o: ['Xác định query nóng (pg_stat_statements), thêm index theo điều kiện lọc và giãn lịch job', 'Scale DB lên 16 vCPU ngay', 'Tăng max_connections', 'Bật query cache ở ứng dụng'], a: 0,
    why: 'Full scan 9,6 triệu dòng × hàng trăm job là lỗi thiếu index, scale máy chỉ mua thời gian; luôn đo (pg_stat_statements) trước khi sửa.' },
  { topic: 'os', t: 'mc', q: 'Container worker bị kill đều đặn ~17 phút một lần; biểu đồ memory tăng tuyến tính rồi rơi về 0; worker xử lý các project rất lớn. Nguyên nhân khả dĩ nhất?',
    o: ['Goroutine leak chậm', 'Mỗi job nạp toàn bộ tập dữ liệu lớn vào RAM song song trên nhiều goroutine, vượt cgroup memory limit rồi bị kill', 'Go GC bị tắt', 'Swap đầy'], a: 1,
    why: 'Hình răng cưa theo chu kỳ job là dấu hiệu nạp dữ liệu không giới hạn (Preload cả bảng) nhân với concurrency; sửa bằng phân trang/stream và bounded worker.' },
  { topic: 'net', t: 'mc', q: 'FE server-side (chạy trong container) gọi API bằng hostname public của chính host và nhận ECONNREFUSED, trong khi gọi từ máy ngoài thì được. Nguyên nhân?',
    o: ['Hairpin NAT của Docker: từ trong container không vòng lại được cổng publish trên IP host; nên gọi qua tên service nội bộ hoặc extra_hosts', 'DNS public cấu hình sai', 'Firewall chặn port 443', 'Chứng chỉ TLS hết hạn'], a: 0,
    why: 'Traffic nội bộ không nên đi vòng ra IP public; dùng DNS nội bộ của Docker network vừa nhanh vừa tránh hairpin.' },
  { topic: 'api', t: 'mc', q: 'Thêm một field bắt buộc mới vào request body của API đang có client cũ làm họ lỗi hàng loạt. Nguyên tắc nào phòng việc này?',
    o: ['Luôn tăng version API mỗi lần deploy', 'Buộc client cập nhật trước khi deploy server', 'Chuyển sang GraphQL', 'Field mới phải optional có default hợp lý; chỉ breaking change khi tăng version API (v2)'], a: 3,
    why: 'Backward compatibility: server mới phải phục vụ được client cũ. Thêm field optional, không đổi nghĩa field cũ, không xoá field.' },
  { topic: 'cache', t: 'mc', q: 'Khi một key nóng hết hạn, hàng nghìn request cùng miss và cùng đánh xuống DB (cache stampede). Kỹ thuật nào xử lý?',
    o: ['Tăng TTL lên 1 ngày', 'Thêm read replica', 'Single-flight (chỉ một request đi nạp, số còn lại chờ kết quả) hoặc refresh sớm trước khi hết hạn', 'Chuyển sang write-through'], a: 2,
    why: 'Go có golang.org/x/sync/singleflight đúng cho việc này; stale-while-revalidate cũng tránh miss đồng loạt.' },
  { topic: 'queue', t: 'mc', q: 'Service publish event audit-created rồi mới commit transaction; consumer nhận event, tra DB không thấy dòng nên FK violation và mất log. Giải pháp chuẩn?',
    o: ['Consumer sleep 1 giây rồi retry', 'Transactional outbox: ghi event vào bảng outbox cùng transaction, relay publish sau khi commit', 'Tăng prefetch của consumer', 'Bật synchronous replication'], a: 1,
    why: 'Publish sau commit mà không có outbox vẫn mất event khi crash giữa chừng; outbox đảm bảo atomic giữa ghi dữ liệu và phát event.' },
  { topic: 'storage', t: 'mc', q: 'Workload ghi rất nặng, đọc ít (log sự kiện, time series). Storage engine nào phù hợp hơn và trả giá bằng gì?',
    o: ['B-tree: ghi tại chỗ, không cần compaction', 'LSM-tree: ghi tuần tự rất nhanh, trả giá bằng read amplification và compaction nền', 'Hash index trên RAM', 'Column store'], a: 1,
    why: 'LSM (RocksDB, Cassandra) biến ghi ngẫu nhiên thành ghi tuần tự; đọc phải tra nhiều SSTable nên cần Bloom filter và compaction.' },
  { topic: 'db', t: 'mc', q: 'Query dài bị huỷ với lỗi canceling statement due to statement timeout dù code đã SET LOCAL statement_timeout = 0 trong transaction; query này lại chạy ngoài transaction. Nguyên nhân?',
    o: ['SET LOCAL chỉ có hiệu lực trong transaction; query ngoài tx áp dụng giá trị cấp role/database (ví dụ 90 s đặt bằng ALTER ROLE)', 'Pool đổi connection giữa chừng', 'Replica lag', 'Lock chờ quá lâu'], a: 0,
    why: 'Timeout có nhiều tầng: cluster, database, role, session, transaction. Phải biết tầng nào đang áp dụng và bọc query dài trong tx hoặc SET ở session.' }
]},
{ id: 'KT2', title: 'Checkpoint khối xây dựng (tuần 13)', minutes: 35, qs: [
  { topic: 'db', t: 'mc', q: 'Synchronous replication (primary chờ replica xác nhận rồi mới trả commit) đổi lấy điều gì?',
    o: ['Throughput ghi cao hơn', 'Đọc từ replica luôn nhanh hơn', 'Không cần ghi WAL', 'Không mất dữ liệu đã ack khi primary chết; trả giá bằng write latency và availability khi replica chậm hoặc chết'], a: 3,
    why: 'Sync replication = RPO 0 nhưng mỗi commit tốn thêm một round trip và phụ thuộc sức khoẻ replica; thường chỉ bật cho 1 replica đồng bộ.' },
  { topic: 'scale', t: 'mc', q: 'Shard một bảng ghi liên tục theo khoảng (range) của created_at gây vấn đề gì?',
    o: ['Không query được theo khoảng thời gian', 'Mọi ghi mới dồn vào shard mới nhất (write hotspot), các shard cũ rảnh', 'Không thể rebalance', 'Mất thứ tự dòng'], a: 1,
    why: 'Range theo thời gian tốt cho đọc theo khoảng nhưng tệ cho ghi; hash theo tenant_id hoặc kết hợp (tenant, time) cân tải tốt hơn.' },
  { topic: 'consistency', t: 'mc', q: 'Hệ KV phân tán có N = 3 bản sao, ghi cần W = 2 ack, đọc hỏi R = 2 node. Điều này đảm bảo gì?',
    o: ['Chịu được 2 node chết đồng thời', 'Chỉ eventual consistency', 'R + W > N nên mỗi lần đọc chạm ít nhất một bản sao có giá trị mới nhất; chịu được 1 node chết', 'Ghi đồng bộ cả 3 node'], a: 2,
    why: 'Quorum chồng lấn (overlap) là cốt lõi của Dynamo/Cassandra tuning; R = W = 1 thì nhanh nhưng có thể đọc dữ liệu cũ.' },
  { topic: 'queue', t: 'mc', q: 'Cần cho một consumer mới đọc lại (replay) toàn bộ event của 7 ngày qua. Loại broker nào phù hợp?',
    o: ['Kafka hoặc broker kiểu log: message giữ theo retention, consumer tự giữ offset', 'RabbitMQ classic queue', 'Redis pub/sub', 'SQS standard'], a: 0,
    why: 'Queue truyền thống xoá message sau ack nên không replay được; log-based broker cho nhiều consumer group đọc độc lập và tua lại.' },
  { topic: 'api', t: 'mc', q: 'Rate limiter cho API gateway chạy nhiều instance. Lưu counter ở đâu để giới hạn nhất quán?',
    o: ['Bộ nhớ của từng instance', 'Postgres với row lock', 'Redis trung tâm với INCR + EXPIRE atomic (hoặc Lua script)', 'Cookie phía client'], a: 2,
    why: 'Counter tại chỗ cho phép N × limit; Redis cho ~100k op/giây với độ trễ dưới 1 ms, chấp nhận sai số nhỏ khi Redis mất.' },
  { topic: 'design', t: 'mc', q: 'Vì sao nhiều hệ thống chọn Snowflake ID (64-bit: timestamp + machine id + sequence) thay UUIDv4 cho khoá chính bảng lớn?',
    o: ['ID tăng gần đơn điệu theo thời gian nên B-tree index ít phân mảnh, và 64-bit nhỏ hơn 128-bit', 'UUIDv4 không thể làm khoá chính', 'Snowflake không cần đồng hồ', 'UUIDv4 cần toạ độ máy'], a: 0,
    why: 'UUIDv4 ngẫu nhiên làm insert rải khắp cây index (page split, cache miss); Snowflake hoặc UUIDv7 giữ tính sắp xếp theo thời gian.' },
  { topic: 'search', t: 'mc', q: 'Vì sao không nên dùng Elasticsearch làm nguồn dữ liệu chính (source of truth)?',
    o: ['ES không hỗ trợ query phức tạp', 'Index là near-real-time, không có transaction ACID; đổi mapping hay reindex có thể mất dữ liệu', 'ES không thể scale ngang', 'ES chỉ lưu được text'], a: 1,
    why: 'ES là index dẫn xuất: giữ dữ liệu gốc ở DB, đồng bộ sang ES và sẵn sàng rebuild index từ DB bất cứ lúc nào.' },
  { topic: 'storage', t: 'mc', q: 'Object storage chống mất dữ liệu với chi phí thấp hơn lưu 3 bản sao đầy đủ bằng kỹ thuật nào?',
    o: ['RAID 0', 'Snapshot hằng ngày', 'Nén dữ liệu', 'Erasure coding: chia k mảnh dữ liệu + m mảnh parity, mất tối đa m mảnh vẫn khôi phục được'], a: 3,
    why: 'Ví dụ 10+4 chỉ tốn 1,4× dung lượng thay vì 3×, trả giá bằng CPU mã hoá và độ trễ đọc khi phải tái tạo mảnh.' },
  { topic: 'data', t: 'mc', q: 'Lambda enrichment gọi API ngoài theo batch 100 coordinate; một phần tử lỗi làm cả batch fail và toàn bộ 100 dòng bị đánh dấu failed vĩnh viễn. Thiết kế cải thiện?',
    o: ['Xử lý lỗi theo từng phần tử (partial failure): cô lập item hỏng, retry riêng, không nuốt lỗi của cả batch', 'Tăng batch lên 1 000 để bù', 'Giảm timeout', 'Chạy tuần tự từng item'], a: 0,
    why: 'Batch chỉ là tối ưu vận chuyển; ngữ nghĩa lỗi phải ở cấp item. Khi batch fail, chia đôi (bisect) hoặc retry từng item để tìm phần tử hỏng.' },
  { topic: 'observability', t: 'mc', q: 'Một request đi qua API server → RabbitMQ → worker → Lambda. Muốn nhìn đường đi end-to-end của đúng request đó, dùng gì?',
    o: ['Correlate log theo timestamp', 'Metrics p99 của từng service', 'Heap profile', 'Distributed tracing: lan truyền trace context (traceparent) qua HTTP header và message header'], a: 3,
    why: 'Metrics cho biết có vấn đề, trace cho biết ở đâu; trace id phải đi xuyên qua message header, không thì span đứt ở queue.' },
  { topic: 'security', t: 'mc', q: 'Một JWT access token bị lộ. Vì sao khó thu hồi và cách giảm thiểu đúng là gì?',
    o: ['Server xoá token khỏi DB là xong', 'JWT luôn được mã hoá nên không lộ gì', 'JWT stateless, server không giữ danh sách token nên không thu hồi được từng cái; giảm thiểu bằng TTL ngắn + refresh token xoay vòng + blocklist jti khi cần', 'Đổi secret ký là xong và không ảnh hưởng ai'], a: 2,
    why: 'Đổi secret đăng xuất toàn bộ người dùng; thiết kế đúng là access token 5-15 phút và refresh token có thể thu hồi.' },
  { topic: 'cloud', t: 'mc', q: 'Watchtower tự kéo image có tag :latest và restart container. Rủi ro chính là gì?',
    o: ['Tốn băng thông', 'Nâng cấp không kiểm soát, phá tương thích (ví dụ DB nhảy major version, không chạy trên kernel cũ); nên pin version và nâng cấp có chủ đích', 'Mất log container', 'Chậm khởi động'], a: 1,
    why: 'Tag :latest không phải phiên bản; mọi deploy phải tái tạo được (pin digest/version) để rollback và điều tra.' },
  { topic: 'realtime', t: 'mc', q: 'Chat server gồm 10 node; user A kết nối node 1 gửi tin tới user B đang kết nối node 7. Định tuyến thế nào?',
    o: ['Broadcast HTTP tới mọi node', 'Pub/sub theo kênh (user/room) hoặc session registry user → node rồi chuyển tiếp tới đúng node', 'Ghi DB và để node đích polling', 'Sticky session trên LB là đủ'], a: 1,
    why: 'Node không chia sẻ bộ nhớ; cần một lớp định tuyến (Redis pub/sub, registry) và broadcast chỉ hợp lý khi số node rất nhỏ.' },
  { topic: 'db', t: 'mc', q: 'Cần tạo index trên bảng lớn đang phục vụ production ở Postgres mà không chặn ghi. Dùng gì?',
    o: ['CREATE INDEX thường vào giờ thấp điểm', 'REINDEX', 'CREATE INDEX CONCURRENTLY (không khoá ghi, chậm hơn, không chạy trong transaction)', 'Tạo bảng mới rồi copy dữ liệu sang'], a: 2,
    why: 'CREATE INDEX thường lấy khoá chặn INSERT/UPDATE suốt thời gian build; CONCURRENTLY quét 2 lần và có thể để lại index INVALID nếu lỗi, phải kiểm tra.' },
  { topic: 'consistency', t: 'mc', q: 'Cụm Raft cần tối thiểu bao nhiêu node để vẫn hoạt động khi 2 node hỏng?',
    o: ['3', '4', '7', '5'], a: 3,
    why: 'Raft cần đa số (quorum) = f + 1 trong 2f + 1 node; chịu f = 2 lỗi cần 5 node. 4 node cũng chỉ chịu 1 lỗi.' },
  { topic: 'scale', t: 'mc', q: 'Cache cluster 3 node dùng consistent hashing nhưng một node nhận 60% key. Nguyên nhân khả dĩ và cách sửa?',
    o: ['Quá ít điểm trên vòng hash nên phân bố lệch; thêm virtual node (100-200 điểm mỗi node vật lý)', 'Hàm hash yếu, đổi sang SHA-256', 'Node đó mạnh hơn nên nhận nhiều hơn', 'Key hot tập trung ở một tenant'], a: 0,
    why: 'Với ít node, khoảng cách trên vòng rất không đều; virtual node làm mịn phân bố và cho phép weight theo năng lực node.' },
  { topic: 'queue', t: 'mc', q: 'Trong thực tế, exactly-once end-to-end (từ producer tới hiệu ứng ở DB) đạt được bằng cách nào?',
    o: ['Broker cam kết exactly-once là đủ', 'At-most-once cộng retry', '2PC giữa broker và DB', 'At-least-once + consumer idempotent (dedupe theo message id, upsert theo business key)'], a: 3,
    why: 'Mạng có thể mất ack bất cứ lúc nào nên luôn có khả năng trùng; idempotency biến trùng thành vô hại.' },
  { topic: 'design', t: 'mc', q: 'Trong SaaS multi-tenant, mô hình dữ liệu nào cách ly mạnh nhất nhưng tốn vận hành nhất?',
    o: ['Database riêng cho mỗi tenant', 'Schema riêng cho mỗi tenant trong một DB', 'Bảng chung với cột tenant_id', 'Row-level security trên bảng chung'], a: 0,
    why: 'DB riêng cách ly hiệu năng, backup, migration nhưng phải chạy migration × N và tốn connection; bảng chung rẻ nhất nhưng dễ leak nếu quên WHERE tenant_id.' },
  { topic: 'security', t: 'mc', q: 'Hai service nội bộ cần xác thực lẫn nhau hai chiều và mã hoá đường truyền. Dùng gì?',
    o: ['Basic auth', 'mTLS (mutual TLS): cả hai bên trình chứng chỉ', 'API key trong header', 'IP allowlist'], a: 1,
    why: 'API key chỉ xác thực một chiều và dễ lộ trong log; mTLS kết hợp định danh + mã hoá, thường do service mesh hoặc sidecar lo.' },
  { topic: 'observability', t: 'mc', q: 'Một cron publisher chết im lặng nhiều ngày không ai biết. Loại alert nào phát hiện sớm nhất?',
    o: ['Alert CPU cao', 'Alert tỉ lệ 5xx', 'Alert theo độ tươi (freshness/heartbeat): tuổi của lần chạy thành công cuối cùng vượt ngưỡng', 'Alert disk đầy'], a: 2,
    why: 'Lỗi im lặng không tạo 5xx hay CPU; chỉ metric kiểu last_success_timestamp (hoặc dead-man switch) mới bắt được việc không xảy ra.' },
  { topic: 'consistency', t: 'mc', q: 'Thanh toán gồm trừ tiền ở service A và tạo đơn ở service B, hai DB khác nhau, không muốn dùng 2PC. Pattern nào?',
    o: ['2PC qua XA', 'Đặt cả hai vào một transaction DB', 'Saga: chuỗi transaction cục bộ, bước sau lỗi thì chạy compensating transaction hoàn tác bước trước', 'Eventual consistency bằng cache'], a: 2,
    why: 'Saga đổi atomic lấy availability; cần thiết kế bước bù (refund) và chấp nhận trạng thái trung gian nhìn thấy được.' },
  { topic: 'data', t: 'mc', q: 'Sweeper mỗi lần lấy 100 dòng pending cũ nhất để xử lý; các dòng lỗi vĩnh viễn luôn nằm đầu danh sách nên dòng mới không bao giờ được xử lý. Tên vấn đề và cách sửa?',
    o: ['Thundering herd, thêm jitter', 'Starvation do poison row: thêm attempt count, exponential backoff (next_retry_at) và chuyển sang failed/DLQ sau N lần', 'Deadlock, rút ngắn transaction', 'Hot key, nhân bản key'], a: 1,
    why: 'Hàng đợi công bằng phải loại hoặc trì hoãn phần tử fail lặp lại; nếu không, một lỗi nhỏ chiếm toàn bộ throughput.' },
  { topic: 'storage', t: 'mc', q: 'Export 2 triệu dòng đang dùng OFFSET pagination, join bảng qua FDW và đọc toàn bộ vào RAM rồi mới trả response, nên chậm và OOM. Cải thiện hợp lý?',
    o: ['Keyset pagination, stream từng chunk ra response ngay, tránh join từ xa (prefetch bảng lookup về local)', 'Tăng RAM container', 'Tăng bước OFFSET lên 10 000', 'Chạy export trên replica'], a: 0,
    why: 'Ba vấn đề độc lập: OFFSET O(N²) tổng, FDW join kéo dữ liệu qua mạng từng lượt, và buffer toàn bộ. Streaming giữ RAM phẳng bất kể số dòng.' },
  { topic: 'db', t: 'mc', q: 'Cần replicate chỉ vài bảng từ Postgres A sang Postgres B khác phiên bản (và B có bảng riêng của nó). Dùng gì?',
    o: ['Streaming physical replication', 'pg_dump theo cron', 'FDW', 'Logical replication (publication/subscription) theo từng bảng'], a: 3,
    why: 'Physical replication sao chép toàn cluster và yêu cầu cùng major version; logical replication gửi thay đổi theo bảng, cho phép B ghi dữ liệu riêng.' },
  { topic: 'api', t: 'mc', q: 'Khi nào nên chọn gRPC thay vì REST/JSON?',
    o: ['Giao tiếp service-to-service nội bộ cần streaming, contract chặt (protobuf) và hiệu năng cao', 'API public cho trình duyệt', 'Webhook gửi cho khách hàng', 'Thay thế message queue'], a: 0,
    why: 'gRPC dùng HTTP/2 + protobuf nhỏ và nhanh, nhưng browser và đối tác bên ngoài cần REST/JSON dễ debug; nhiều hệ dùng cả hai.' },
  { topic: 'cloud', t: 'mc', q: 'Lambda enrichment mất các biến môi trường RABBITMQ_* sau một lần redeploy khiến publish lỗi âm thầm. Cách phòng ngừa về vận hành?',
    o: ['Tăng timeout Lambda', 'Thêm retry khi connect', 'Quản lý cấu hình bằng IaC (Terraform/SAM) và fail-fast khi thiếu env thay vì fallback giá trị mặc định', 'Chuyển sang EC2'], a: 2,
    why: 'Sửa tay trên console bị ghi đè ở lần deploy sau; config phải nằm trong code và thiếu config phải làm hàm chết ngay lúc init.' },
  { topic: 'search', t: 'mc', q: 'Autocomplete trả top-k gợi ý theo prefix với độ trễ dưới 50 ms ở 100 000 QPS. Cấu trúc dữ liệu cốt lõi?',
    o: ['LIKE prefix% trên DB có index', 'Inverted index full-text rồi sort theo score lúc query', 'Quét bảng từ khoá sắp theo tần suất', 'Trie với top-k đã tính sẵn ở mỗi node, phục vụ từ RAM, rebuild offline định kỳ'], a: 3,
    why: 'Mỗi query chỉ đi theo prefix rồi đọc danh sách sẵn có, O(độ dài prefix); tính top-k lúc query không kịp ở tải này.' },
  { topic: 'scale', t: 'mc', q: 'Scheduled scan chạy chập chờn: scheduler in-memory (gocron) nằm trong container bị Watchtower redeploy 30 giây nên lỡ tick; chạy 2 replica thì job chạy 2 lần. Giải pháp?',
    o: ['Tăng tần suất tick', 'Persist lịch (next_run_at trong DB) + lock phân tán/leader election + xử lý catch-up cho tick bị lỡ', 'Tắt Watchtower', 'Chỉ chạy một replica'], a: 1,
    why: 'Scheduler phải có state bền và duy nhất một người điều phối; lịch trong RAM của một process là single point of failure.' },
  { topic: 'consistency', t: 'mc', q: 'Reconcile policy kiểu diff toàn bộ: một lần eval lỗi (trả 0 kết quả) xoá mềm toàn bộ violation của lần eval tốt trước đó. Nguyên tắc nào bị vi phạm và sửa thế nào?',
    o: ['Idempotency', 'Ordering', 'Phân biệt kết quả rỗng với thất bại: chỉ reconcile trong phạm vi đã eval thành công, lỗi thì giữ nguyên trạng thái cũ', 'Isolation level'], a: 2,
    why: 'Không có vi phạm và không đánh giá được là hai trạng thái khác nhau; mọi job đồng bộ kiểu diff phải tính xoá theo phạm vi đã quan sát đầy đủ.' },
  { topic: 'observability', t: 'mc', q: 'SLO availability 99,9% trong 30 ngày tương đương error budget bao nhiêu thời gian downtime?',
    o: ['4,3 phút', '~43 phút', '3,6 giờ', '7,2 giờ'], a: 1,
    why: '30 ngày = 43 200 phút; 0,1% = 43,2 phút. 99,99% là 4,3 phút, 99,5% là 3,6 giờ, 99% là 7,2 giờ.' }
]},
{ id: 'KT3', title: 'Checkpoint case study (tuần 20)', minutes: 35, qs: [
  { topic: 'design', t: 'mc', q: 'URL shortener dùng mã rút gọn 7 ký tự base62. Không gian mã xấp xỉ bao nhiêu URL?',
    o: ['62^7 ≈ 3,5 nghìn tỷ', '62^6 ≈ 57 tỷ', '2^32 ≈ 4,3 tỷ', '10^7 = 10 triệu'], a: 0,
    why: '3,5 × 10^12 đủ cho hàng trăm năm ở mức 1 000 URL mới mỗi giây (3 × 10^10 mỗi năm).' },
  { topic: 'db', t: 'mc', q: 'URL shortener chạy nhiều API node. Cách sinh mã rút gọn nào vừa tránh collision vừa không có điểm nghẽn?',
    o: ['Random 7 ký tự rồi kiểm tra trùng trong DB', 'Lấy 7 ký tự đầu của MD5(url)', 'ID duy nhất từ ID generator (Snowflake hoặc cấp dải key cho từng node) rồi encode base62', 'Auto-increment của một DB duy nhất'], a: 2,
    why: 'Hash cắt ngắn chắc chắn collision khi lớn; random cần vòng retry; auto-increment một DB là SPOF. Dải key hoặc Snowflake không cần phối hợp mỗi lần tạo.' },
  { topic: 'api', t: 'mc', q: 'URL shortener muốn đếm số click từng link. Redirect nên dùng mã HTTP nào và vì sao?',
    o: ['301 vì tốt cho SEO', '302 (hoặc 307) để browser không cache redirect, mỗi click đều qua server để đếm', '304 để tiết kiệm băng thông', '200 kèm JavaScript redirect'], a: 1,
    why: '301 được browser cache vĩnh viễn nên lần sau không gọi server nữa, mất thống kê; đổi lại 301 giảm tải nếu không cần đếm.' },
  { topic: 'api', t: 'mc', q: 'Rate limiter cho API cần cho phép burst ngắn (ví dụ 20 request liền) nhưng giữ trung bình 5 request/giây. Thuật toán nào phù hợp?',
    o: ['Fixed window counter', 'Sliding log', 'Leaky bucket', 'Token bucket (dung lượng 20, nạp 5 token/giây)'], a: 3,
    why: 'Leaky bucket làm phẳng đầu ra nên không cho burst; token bucket cho tiêu hết token tích luỹ rồi về tốc độ nạp.' },
  { topic: 'cache', t: 'mc', q: 'Rate limiter trên Redis cho phép vượt giới hạn gần 2 lần khi tải cao, dù logic kiểm tra có vẻ đúng. Nguyên nhân khả dĩ nhất?',
    o: ['Redis chậm', 'Clock skew giữa các server', 'TTL của cửa sổ quá dài', 'GET rồi SET không atomic giữa nhiều instance nên nhiều request cùng thấy counter cũ; dùng INCR hoặc Lua script'], a: 3,
    why: 'Check-then-act qua mạng là race kinh điển; mọi thao tác đọc-quyết định-ghi phải gói trong một lệnh atomic ở Redis.' },
  { topic: 'storage', t: 'mc', q: 'Trong KV store kiểu LSM (Cassandra, RocksDB), bước đầu tiên của đường ghi để đảm bảo durability là gì?',
    o: ['Ghi vào memtable', 'Append vào WAL (commit log) trên đĩa', 'Flush ra SSTable', 'Compaction'], a: 1,
    why: 'Memtable ở RAM nên mất khi crash; WAL append tuần tự rất rẻ và cho phép replay. Thứ tự: WAL → memtable → SSTable → compaction.' },
  { topic: 'consistency', t: 'mc', q: 'KV store kiểu Dynamo: khi nào nên dùng vector clock thay vì last-write-wins để xử lý xung đột?',
    o: ['Khi cần phát hiện update đồng thời để merge ở client (ví dụ giỏ hàng không được mất món)', 'Khi dữ liệu là log append-only', 'Khi chỉ có một writer', 'Khi dùng strong consistency'], a: 0,
    why: 'LWW âm thầm vứt một bản ghi; vector clock cho biết hai phiên bản là concurrent để ứng dụng tự quyết cách gộp, trả giá bằng độ phức tạp.' },
  { topic: 'scale', t: 'mc', q: 'KV store phân tán: một node tạm chết đúng lúc có ghi tới nó. Cách giữ availability cho ghi mà vẫn bù lại dữ liệu sau?',
    o: ['Từ chối ghi cho đến khi node về', 'Read repair', 'Hinted handoff: node khác tạm giữ bản ghi kèm gợi ý, trả lại khi node hồi phục', 'Chạy Merkle tree anti-entropy ngay lập tức'], a: 2,
    why: 'Hinted handoff là sloppy quorum cho đường ghi; read repair và anti-entropy sửa sai ở đường đọc và nền, không giữ availability ghi.' },
  { topic: 'queue', t: 'mc', q: 'Hệ thống notification gửi 10 triệu push; worker retry khi provider timeout. Làm sao không gửi trùng cho người dùng?',
    o: ['Chỉ gửi một lần, không retry', 'Gắn idempotency key (notification_id) và kiểm tra/ghi vào dedupe store trước khi gọi provider', 'Tăng timeout gọi provider', 'Dựa vào exactly-once của queue'], a: 1,
    why: 'Timeout không có nghĩa là chưa gửi; dedupe theo id ở phía mình (và truyền id cho provider nếu hỗ trợ) là cách duy nhất chắc chắn.' },
  { topic: 'design', t: 'mc', q: 'Notification system có 3 kênh SMS, email, push với tốc độ và giới hạn provider khác nhau. Tổ chức hàng đợi thế nào?',
    o: ['Queue riêng cho từng kênh, rate limit theo provider, ưu tiên riêng (OTP trước marketing)', 'Một queue chung FIFO cho mọi kênh', 'Gửi đồng bộ ngay trong request tạo thông báo', 'Lưu DB rồi cron gửi một lần mỗi ngày'], a: 0,
    why: 'Kênh chậm (SMS bị provider throttle) không được chặn kênh nhanh; tách queue cho phép scale và retry độc lập.' },
  { topic: 'scale', t: 'mc', q: 'News feed dùng fan-out on write. Một user có 10 triệu follower đăng bài làm hàng đợi fan-out tắc 10 phút. Giải pháp?',
    o: ['Tăng số worker fan-out', 'Chuyển hoàn toàn sang fan-out on read', 'Bỏ feed cache', 'Hybrid: fan-out on write cho user thường, fan-out on read (merge lúc đọc) cho tài khoản có quá nhiều follower'], a: 3,
    why: 'Celebrity problem: 1 bài = 10 triệu ghi. Chỉ cần đổi chiến lược cho số ít tài khoản vượt ngưỡng follower.' },
  { topic: 'cache', t: 'mc', q: 'Feed cache trong Redis của news feed nên lưu gì?',
    o: ['Toàn bộ nội dung từng post', 'HTML đã render của feed', 'Danh sách post_id (sorted set theo thời gian) giới hạn vài trăm phần tử; nội dung post hydrate từ cache post riêng', 'Không nên cache feed'], a: 2,
    why: 'Lưu id nhỏ, dedupe nội dung post dùng chung giữa hàng triệu feed, và sửa một post không phải cập nhật mọi feed.' },
  { topic: 'realtime', t: 'mc', q: 'Chat: đảm bảo thứ tự tin nhắn trong một kênh nhất quán cho mọi thành viên dựa vào gì?',
    o: ['Timestamp do client gửi', 'Timestamp server lúc nhận ở bất kỳ node nào', 'Sequence number tăng dần cấp theo từng channel bởi server (một nguồn cấp số cho mỗi channel)', 'UUID của tin nhắn'], a: 2,
    why: 'Đồng hồ client và nhiều node server đều lệch; thứ tự toàn cục chỉ cần trong một kênh nên cấp số theo kênh là đủ và scale được.' },
  { topic: 'db', t: 'mc', q: 'Lưu lịch sử tin nhắn chat hàng tỷ dòng, truy vấn chủ yếu là lấy N tin mới nhất của một kênh. Mô hình lưu trữ phù hợp?',
    o: ['Postgres một bảng messages chỉ index theo id', 'Elasticsearch', 'Redis list', 'Wide-column store (Cassandra/HBase) partition theo channel_id, cluster theo message_id giảm dần'], a: 3,
    why: 'Mọi tin của một kênh nằm liền nhau trên một partition nên đọc tuần tự; ghi phân tán theo kênh. Postgres partition theo kênh cũng được ở quy mô nhỏ hơn.' },
  { topic: 'realtime', t: 'mc', q: 'Tính năng online presence làm Redis và mạng quá tải vì mỗi lần một user online/offline hệ thống đẩy thông báo tới toàn bộ bạn bè. Thiết kế lại thế nào?',
    o: ['Heartbeat 30 giây + key TTL; chỉ fan-out trạng thái tới bạn bè đang online và theo batch, client chủ động hỏi khi mở danh sách', 'Ghi DB mỗi heartbeat', 'Broadcast tới toàn bộ user trong hệ thống', 'Polling mỗi giây từ client'], a: 0,
    why: 'Presence là dữ liệu chấp nhận trễ vài chục giây; đẩy ít, kéo khi cần (lazy) và giới hạn fan-out cho người thực sự nhìn thấy.' },
  { topic: 'data', t: 'mc', q: 'Autocomplete gợi ý top-k theo tần suất tìm kiếm nhưng gợi ý toàn từ khoá cũ, không phản ánh xu hướng mới. Cách cập nhật hợp lý?',
    o: ['Cập nhật trie ngay sau mỗi query', 'Rebuild top-k offline theo batch từ log tìm kiếm (mỗi giờ/ngày) rồi hoán đổi cây mới; có thể cộng thêm lớp trending ngắn hạn', 'Tăng cache TTL', 'Chuyển sang LIKE trên DB'], a: 1,
    why: 'Cập nhật realtime từng node trie ở hàng trăm nghìn QPS rất tốn khoá; pipeline batch từ log rẻ và đủ tươi cho hầu hết sản phẩm.' },
  { topic: 'storage', t: 'mc', q: 'Phát video mượt trên mạng chập chờn (băng thông thay đổi) dùng kỹ thuật nào?',
    o: ['Tải trọn file trước khi phát', 'WebSocket đẩy từng frame', 'Adaptive bitrate streaming (HLS/DASH): chia video thành segment vài giây ở nhiều bitrate, client tự chọn theo băng thông', 'Tăng bitrate cố định cho chất lượng'], a: 2,
    why: 'Transcode thành nhiều bậc chất lượng lúc upload; client đổi bậc giữa các segment nên không bị dừng hình.' },
  { topic: 'cloud', t: 'mc', q: 'Thumbnail và segment video phục vụ 100 triệu lượt xem mỗi ngày trên toàn cầu. Nên phục vụ từ đâu?',
    o: ['Từ API server', 'CDN với origin là object storage; API chỉ trả URL (có chữ ký nếu cần)', 'Trực tiếp từ bucket S3 ở một region', 'Từ Redis cache'], a: 1,
    why: 'CDN đưa nội dung tĩnh tới edge gần người dùng, giảm độ trễ liên lục địa ~150 ms và giảm egress từ origin.' },
  { topic: 'storage', t: 'mc', q: 'Drive: người dùng sửa 1 KB trong file 1 GB. Client đồng bộ thế nào cho hiệu quả?',
    o: ['Upload lại cả file', 'Chia file thành block (ví dụ 4 MB), hash từng block, chỉ upload block thay đổi (delta sync); metadata lưu danh sách block', 'Nén file rồi upload', 'Gửi qua WebSocket'], a: 1,
    why: 'Block-level sync còn cho phép dedupe block giữa người dùng và resume upload; đổi lại metadata phức tạp hơn.' },
  { topic: 'consistency', t: 'mc', q: 'Drive: hai thiết bị cùng sửa một file khi offline rồi cùng đồng bộ. Hệ thống nên xử lý thế nào?',
    o: ['Last-write-wins âm thầm', 'Khoá file toàn cục khi có người mở', 'Từ chối ghi offline', 'Giữ cả hai phiên bản (tạo conflict copy) nhờ version vector/version id, để người dùng tự merge'], a: 3,
    why: 'Mất công việc người dùng là tệ nhất; phát hiện conflict bằng version và không tự quyết là cách Dropbox/Drive làm.' },
  { topic: 'consistency', t: 'mc', q: 'Payment: gọi cổng thanh toán (PSP) bị timeout, không biết đã trừ tiền hay chưa. Xử lý đúng?',
    o: ['Retry ngay không kèm key', 'Hoàn tiền tự động', 'Idempotency key gửi kèm PSP + đưa giao dịch về trạng thái pending + đối soát (reconciliation) định kỳ với PSP', 'Bỏ qua và báo thành công'], a: 2,
    why: 'Timeout là trạng thái không xác định; chỉ có idempotent retry hoặc hỏi lại PSP mới biết sự thật, không được đoán.' },
  { topic: 'db', t: 'mc', q: 'Payment: lưu số dư tài khoản như thế nào để audit được và tránh lost update?',
    o: ['Sổ cái (ledger) double-entry, append-only; số dư là tổng dẫn xuất hoặc snapshot định kỳ', 'UPDATE trực tiếp cột balance', 'Lưu số dư trong Redis', 'Lưu file CSV mỗi ngày'], a: 0,
    why: 'Mỗi giao dịch là hai dòng ghi nợ/có bất biến, tổng luôn bằng 0; sửa số dư tại chỗ mất lịch sử và dễ race.' },
  { topic: 'data', t: 'mc', q: 'Metrics system lưu 10 triệu time series, mỗi series 1 điểm/10 giây, giữ 1 năm. Cách giảm dung lượng?',
    o: ['Lưu JSON mỗi điểm', 'Tăng dung lượng đĩa', 'Xoá dữ liệu cũ hơn 1 ngày', 'Downsampling theo tầng retention (raw 7 ngày, 1 phút 90 ngày, 1 giờ 1 năm) + nén delta-of-delta/XOR kiểu Gorilla'], a: 3,
    why: '10^7 × 8 640 điểm/ngày = 8,6 × 10^10 điểm/ngày; không nén và không downsample thì không hệ thống nào chịu nổi.' },
  { topic: 'storage', t: 'mc', q: 'Metrics system: engine lưu trữ nào phù hợp cho time series ghi dồn dập và xoá theo tuổi?',
    o: ['B-tree row store cập nhật tại chỗ', 'Document DB', 'TSDB: partition theo time block, nén theo block, hết retention thì xoá nguyên block', 'Graph DB'], a: 2,
    why: 'Xoá từng dòng theo tuổi tốn kém; xoá theo block (drop partition) là O(1). Prometheus TSDB và InfluxDB đều làm vậy.' },
  { topic: 'data', t: 'mc', q: 'Ad click aggregation: tổng số click mỗi phút theo ad_id lệch với báo cáo cuối ngày vì event đến trễ vài phút. Thiết kế đúng?',
    o: ['Bỏ event trễ', 'Stream processing với event-time window + watermark/allowed lateness; kết quả cuối đối soát bằng batch job cuối ngày', 'Dùng processing time thay vì event time', 'Tăng window lên 1 giờ'], a: 1,
    why: 'Stream cho số gần đúng nhanh, batch cho số đúng muộn; hợp đồng với khách thường chốt theo kết quả batch.' },
  { topic: 'search', t: 'mc', q: 'Proximity service: tìm quán ăn trong bán kính 1 km quanh người dùng với hàng triệu địa điểm. Index thế nào?',
    o: ['Geohash hoặc quadtree (grid index) để lấy ô lân cận rồi lọc chính xác bằng khoảng cách haversine', 'Hai B-tree riêng trên lat và lng', 'Full scan tính haversine mọi điểm', 'Inverted index theo tên quán'], a: 0,
    why: 'Hai index riêng không giao nhau hiệu quả; geohash biến truy vấn 2 chiều thành prefix 1 chiều, Postgres có PostGIS/GiST làm việc này.' },
  { topic: 'queue', t: 'mc', q: 'Thiết kế message queue kiểu log (như Kafka): vì sao lưu message trong file append-only theo partition?',
    o: ['Sequential IO rất nhanh, nhiều consumer group đọc độc lập theo offset riêng, và có thể replay', 'Vì file dễ backup', 'Vì tiết kiệm RAM', 'Vì không cần index'], a: 0,
    why: 'Append-only + page cache của OS cho throughput hàng trăm MB/s mỗi broker (hàng chục MB/s mỗi partition); offset là con trỏ rẻ thay cho việc xoá message sau ack.' },
  { topic: 'concurrency', t: 'mc', q: 'Hệ thống đặt vé: hai người cùng đặt một ghế và cả hai thành công (double booking). Cách sửa đúng?',
    o: ['Kiểm tra ghế trống rồi INSERT, không khoá', 'Cache trạng thái ghế ở Redis', 'Đưa mọi request đặt vé vào một queue tuần tự toàn hệ thống', 'Optimistic locking (cột version) hoặc SELECT FOR UPDATE trên dòng ghế, cộng giữ chỗ tạm có TTL (ví dụ 10 phút)'], a: 3,
    why: 'Check-then-insert là race; khoá dòng hoặc version + unique constraint (seat_id, show_id) đảm bảo chỉ một giao dịch thắng. Queue toàn cục đúng nhưng nghẽn.' },
  { topic: 'net', t: 'mc', q: 'Web crawler tải 1 tỷ trang cần tránh tải trùng URL với bộ nhớ nhỏ. Dùng cấu trúc nào?',
    o: ['Bloom filter (chấp nhận false positive nhỏ, vài GB cho 1 tỷ URL)', 'Set in-memory chứa toàn bộ URL', 'Unique index trong DB tra từng URL', 'Sort file URL rồi dedupe'], a: 0,
    why: 'Bloom filter trả lời chắc chắn chưa thấy hoặc có thể đã thấy với ~1% sai ở 10 bit/phần tử; bỏ sót vài trang mới là chấp nhận được với crawler.' },
  { topic: 'design', t: 'mc', q: 'Distributed job scheduler chạy 3 instance; job hằng ngày chạy 2-3 lần, và khi deploy đúng giờ chạy thì job bị bỏ qua hẳn. Thiết kế đúng?',
    o: ['Tăng interval kiểm tra', 'Chỉ chạy một instance', 'Dùng cron của hệ điều hành trên mỗi máy', 'Leader election hoặc lock phân tán cho mỗi lần chạy + persist next_run_at trong DB + job idempotent và catch-up khi khởi động'], a: 3,
    why: 'Lịch là state, phải bền và chỉ một người cầm quyền kích hoạt; job idempotent là lưới an toàn khi lock và persist vẫn trượt.' }
]},
{ id: 'KT4', title: 'Tổng duyệt trước phỏng vấn (tuần 24)', minutes: 40, qs: [
  { topic: 'go', t: 'mc', q: 'context.Context trong Go dùng để làm gì?',
    o: ['Lưu cấu hình toàn cục của ứng dụng', 'Thay thế mutex khi chia sẻ dữ liệu', 'Lan truyền cancel/timeout/deadline và giá trị request-scoped xuyên qua chuỗi gọi hàm và goroutine', 'Quản lý goroutine pool'], a: 2,
    why: 'Mọi hàm IO nên nhận ctx làm tham số đầu để request bị huỷ thì DB query, HTTP call phía dưới dừng theo, tránh lãng phí và goroutine leak.' },
  { topic: 'concurrency', t: 'mc', q: 'Gửi giá trị vào unbuffered channel khi không có goroutine nào đang nhận thì chuyện gì xảy ra?',
    o: ['Panic', 'Goroutine gửi block vô thời hạn (goroutine leak, hoặc deadlock nếu không còn goroutine nào chạy)', 'Hàm trả về lỗi', 'Giá trị bị drop'], a: 1,
    why: 'Unbuffered channel là điểm hẹn đồng bộ; luôn có đường thoát bằng select với ctx.Done() hoặc buffer đủ lớn.' },
  { topic: 'cloud', t: 'mc', q: 'Autoscale số worker tiêu thụ queue nên dựa trên metric nào?',
    o: ['CPU trung bình của worker', 'RAM', 'Network IO', 'Queue depth (backlog) hoặc tuổi của message cũ nhất chia cho số consumer'], a: 3,
    why: 'Worker chờ IO có CPU thấp dù hàng đợi dài; tín hiệu đúng là công việc đang chờ, không phải tài nguyên đang dùng.' },
  { topic: 'design', t: 'mc', q: 'Hệ thống 100 triệu DAU, mỗi user 10 request/ngày, đỉnh gấp 3 lần trung bình. QPS đỉnh xấp xỉ?',
    o: ['~30 000', '~10 000', '~3 000', '~300 000'], a: 0,
    why: '10^9 request/ngày ÷ 10^5 giây = 10^4 QPS trung bình; × 3 = 30 000 QPS đỉnh.' },
  { topic: 'db', t: 'mc', q: 'Bảng Postgres bị UPDATE liên tục phình to gấp nhiều lần dù số dòng không đổi, query chậm dần. Nguyên nhân?',
    o: ['Dead tuple do MVCC (mỗi UPDATE tạo bản ghi mới), autovacuum không theo kịp hoặc bị long transaction chặn', 'WAL không được xoá', 'Index bị trùng', 'Dữ liệu TOAST'], a: 0,
    why: 'Kiểm tra pg_stat_user_tables.n_dead_tup và transaction treo (idle in transaction); chỉnh autovacuum mạnh hơn cho bảng nóng.' },
  { topic: 'cache', t: 'mc', q: 'Redis vừa làm cache vừa giữ counter rate limit; yêu cầu khi crash không mất quá 1 giây dữ liệu. Cấu hình persistence?',
    o: ['RDB snapshot mỗi 5 phút', 'Replica async là đủ', 'Không cần, cache mất thì nạp lại', 'AOF với appendfsync everysec'], a: 3,
    why: 'RDB mất cả khoảng giữa hai snapshot; AOF everysec ghi log lệnh mỗi giây, cân bằng giữa durability và hiệu năng (always quá chậm).' },
  { topic: 'queue', t: 'mc', q: 'Producer tạo message nhanh hơn consumer xử lý, hàng đợi tăng không giới hạn và broker sắp hết đĩa. Nguyên tắc xử lý?',
    o: ['Tăng RAM/đĩa cho broker', 'Backpressure: giới hạn độ dài queue, làm chậm hoặc shed load ở producer, scale consumer theo backlog', 'Tắt ack để consumer nhanh hơn', 'Xoá message cũ nhất'], a: 1,
    why: 'Hệ thống phải có điểm nói không; buffer vô hạn chỉ đổi chỗ sự cố và làm độ trễ end-to-end tăng vô hạn.' },
  { topic: 'go', t: 'mc', q: 'Một counter chỉ increment và đọc, tranh chấp cao giữa nhiều goroutine. Cơ chế đồng bộ nhẹ nhất?',
    o: ['sync.Mutex', 'sync.RWMutex', 'atomic.Int64 (sync/atomic)', 'Channel gửi mỗi lần tăng'], a: 2,
    why: 'Atomic là một lệnh CPU, không có lock và không chuyển ngữ cảnh; Mutex hợp khi bảo vệ nhiều trường cùng lúc.' },
  { topic: 'concurrency', t: 'mc', q: 'Code spawn một goroutine cho mỗi phần tử của slice 1 triệu phần tử để gọi API ngoài. Hậu quả và cách sửa?',
    o: ['Không sao vì goroutine rất nhẹ', 'Tràn file descriptor/RAM và bị API ngoài rate limit; dùng worker pool hoặc semaphore (errgroup.SetLimit, buffered channel)', 'Panic vì hết stack', 'Deadlock'], a: 1,
    why: 'Goroutine rẻ nhưng socket, RAM buffer và quota của bên kia thì không; concurrency phải bị chặn trên (bounded).' },
  { topic: 'net', t: 'mc', q: 'gRPC chạy trên HTTP/2 giải quyết head-of-line blocking ở tầng nào và còn tồn tại ở tầng nào?',
    o: ['Giải quyết ở cả hai tầng', 'Không giải quyết tầng nào', 'Giải quyết HOL ở tầng HTTP (multiplex nhiều stream trên một kết nối) nhưng vẫn còn HOL ở TCP: một gói mất chặn mọi stream; HTTP/3 (QUIC) xử lý phần này', 'Chỉ giải quyết ở tầng TCP'], a: 2,
    why: 'HTTP/1.1 cần nhiều kết nối; HTTP/2 một kết nối nhiều stream; QUIC đưa stream xuống transport trên UDP để mất gói chỉ chặn một stream.' },
  { topic: 'os', t: 'mc', q: 'Go service trong container giới hạn 2 CPU trên host 64 core có latency thất thường và GC pause dài (Go bản cũ hoặc chưa bật cgroup-aware). Nguyên nhân khả dĩ?',
    o: ['GOMAXPROCS = 64 theo số core host nên quá nhiều thread tranh 2 CPU quota, bị CFS throttling; đặt GOMAXPROCS theo cgroup limit (uber automaxprocs)', 'GC bị tắt', 'Thiếu RAM', 'Disk chậm'], a: 0,
    why: 'Runtime nhìn thấy CPU của host, không phải quota của container; throttling xuất hiện trong cpu.stat (nr_throttled).' },
  { topic: 'api', t: 'mc', q: 'Thiết kế hệ thống gửi webhook cho khách hàng. Tập hợp yêu cầu nào là đúng?',
    o: ['Gửi đồng bộ ngay trong request và chờ khách trả lời', 'Không retry để tránh trùng', 'Gửi payload không ký để đơn giản', 'Retry với exponential backoff + jitter, event id để khách dedupe, ký HMAC payload, timeout ngắn, chuyển DLQ sau N lần'], a: 3,
    why: 'Endpoint của khách có thể chậm, chết hoặc giả mạo; webhook là at-least-once có chữ ký, và khách phải xử lý idempotent.' },
  { topic: 'consistency', t: 'mc', q: 'Khác biệt giữa linearizability và serializability?',
    o: ['Hai khái niệm giống nhau', 'Linearizability yếu hơn serializability', 'Serializability chỉ áp dụng cho NoSQL', 'Linearizability: thao tác trên một object hiện ra tức thì theo thứ tự thời gian thực; Serializability: nhiều transaction đa object tương đương một thứ tự tuần tự nào đó, không ràng buộc thời gian thực'], a: 3,
    why: 'Strict serializability là cả hai cộng lại (Spanner). Isolation SERIALIZABLE của DB không hứa đọc thấy ngay ghi mới nhất theo đồng hồ tường.' },
  { topic: 'go', t: 'mc', q: 'Số goroutine của HTTP service tăng dần theo thời gian (pprof /debug/pprof/goroutine) dù tải ổn định. Nguyên nhân phổ biến nhất?',
    o: ['Goroutine chờ channel/lock không ai giải phóng, không có select ctx.Done(), hoặc không đóng response body nên goroutine của Transport treo', 'GC chạy chậm', 'Quá nhiều CPU', 'Log quá nhiều'], a: 0,
    why: 'Goroutine leak không gây crash ngay nhưng ăn RAM dần; pprof goroutine stack cho thấy chúng kẹt ở đâu, thường là chan send/recv.' },
  { topic: 'cloud', t: 'mc', q: 'Yêu cầu RTO vài phút và RPO gần 0 khi một availability zone sập, chi phí hợp lý. Kiến trúc?',
    o: ['Multi-region active-active', 'Single AZ với backup hằng ngày', 'Multi-AZ active-passive: DB replica đồng bộ ở AZ khác, failover tự động, app chạy ở 2+ AZ', 'Multi-region active-passive'], a: 2,
    why: 'Multi-AZ cùng region có độ trễ ~1-2 ms nên replicate đồng bộ được; multi-region đắt gấp nhiều lần và phải chấp nhận async.' },
  { topic: 'scale', t: 'mc', q: 'Bảng partition theo tenant_id; một tenant chiếm 80% dữ liệu làm mọi query của tenant khác chậm theo. Hướng xử lý?',
    o: ['Tăng vCPU cho DB', 'Tách tenant lớn ra partition/DB riêng (isolation tier) và sub-partition theo thời gian; rate limit theo tenant', 'Xoá dữ liệu cũ', 'Bỏ partition'], a: 1,
    why: 'Noisy neighbour cần cách ly vật lý, không phải scale chung; đây cũng là lý do SaaS có gói enterprise chạy DB riêng.' },
  { topic: 'concurrency', t: 'mc', q: 'Distributed lock bằng Redis SETNX với TTL 10 giây; job thực tế chạy 15 giây. Hậu quả và cách sửa?',
    o: ['Job thứ hai sẽ chờ job đầu xong', 'Không có hậu quả', 'Lock hết hạn khi job còn chạy, job khác lấy được lock và hai job chạy song song; cần fencing token kiểm tra ở tài nguyên đích hoặc gia hạn lock định kỳ (watchdog)', 'Redis tự gia hạn lock'], a: 2,
    why: 'TTL là để tránh lock mồ côi, không đảm bảo loại trừ tuyệt đối; fencing token (số tăng dần) để storage từ chối writer cũ.' },
  { topic: 'security', t: 'mc', q: 'SaaS multi-tenant cần SSO với IdP riêng của từng khách hàng (Okta, Azure AD). Giao thức?',
    o: ['Basic auth', 'API key cấp cho mỗi khách', 'LDAP bind trực tiếp tới AD của khách', 'OIDC Authorization Code (+PKCE) hoặc SAML, cấu hình IdP theo tenant, map claim sang user/role nội bộ'], a: 3,
    why: 'OIDC/SAML là chuẩn mà mọi IdP doanh nghiệp hỗ trợ; ứng dụng không bao giờ thấy mật khẩu người dùng.' },
  { topic: 'storage', t: 'mc', q: 'File SBOM gốc hiếm khi được đọc sau 90 ngày nhưng phải giữ 3 năm. Tối ưu chi phí?',
    o: ['Lifecycle policy chuyển object sang lớp lạnh (IA/Glacier) sau 90 ngày; metadata và kết quả parse vẫn ở DB nóng', 'Xoá sau 90 ngày', 'Nén và lưu vào DB', 'Chép sang EBS'], a: 0,
    why: 'Object storage có bậc giá theo tần suất truy cập chênh 5-20 lần; đổi lại thời gian lấy lại file lạnh có thể hàng phút tới giờ.' },
  { topic: 'observability', t: 'mc', q: 'Prometheus RAM tăng vọt sau khi thêm label user_id vào metric http_requests_total. Nguyên nhân?',
    o: ['Disk đầy', 'Cardinality explosion: mỗi giá trị user_id tạo một time series riêng, hàng triệu series ăn RAM và làm query chậm', 'Scrape interval quá ngắn', 'Histogram quá nhiều bucket'], a: 1,
    why: 'Label chỉ dành cho tập giá trị nhỏ và hữu hạn (endpoint, status); định danh có cardinality cao thuộc về log hoặc trace.' },
  { topic: 'db', t: 'mc', q: 'Lambda kết nối Postgres qua PgBouncer transaction pooling mode; lệnh SET statement_timeout cấp session có vẻ không có hiệu lực. Vì sao?',
    o: ['Lambda không hỗ trợ lệnh SET', 'Transaction pooling gán connection khác cho mỗi transaction nên tham số cấp session không bám theo client; phải SET LOCAL trong từng transaction', 'Thiếu quyền', 'Role đã override'], a: 1,
    why: 'Mọi session state (SET, prepared statement, advisory lock) đều không an toàn ở transaction mode; đó là giá của việc gom connection.' },
  { topic: 'queue', t: 'mc', q: 'RabbitMQ: một consumer bị OOM với hàng chục nghìn message unacked trong khi các consumer khác rảnh. Nguyên nhân?',
    o: ['Prefetch không giới hạn (prefetch_count = 0) nên broker đẩy toàn bộ message có sẵn vào consumer đầu tiên kết nối', 'Message quá lớn', 'Consumer xử lý chậm', 'Queue không durable'], a: 0,
    why: 'Đặt prefetch nhỏ (10-100) để broker chia đều và consumer không ôm quá sức; prefetch cũng là backpressure phía consumer.' },
  { topic: 'design', t: 'mc', q: 'Cần đảm bảo ghi DB và publish event hoặc cùng thành công hoặc cùng không, mà không dùng 2PC. Pattern?',
    o: ['2PC/XA giữa DB và broker', 'Publish trước rồi commit', 'Commit rồi publish, không có cơ chế bù', 'Transactional outbox: ghi event vào bảng outbox trong cùng transaction, relay/CDC đọc outbox và publish, consumer idempotent'], a: 3,
    why: 'Commit rồi publish mất event khi crash giữa hai bước; outbox biến hai hệ thống thành một transaction cục bộ duy nhất.' },
  { topic: 'go', t: 'mc', q: 'Worker Go nạp dữ liệu lớn có RSS cao gấp đôi live heap. GOGC mặc định 100 nghĩa là gì và điều chỉnh gì cho container?',
    o: ['Heap tối đa 100 MB', 'GC chạy mỗi 100 ms', 'GC kích hoạt khi heap đạt 2× live heap sau lần GC trước; trong container nên đặt GOMEMLIMIT theo memory limit để GC chạy mạnh hơn khi gần ngưỡng', 'GC chạy khi có 100 object mới'], a: 2,
    why: 'GOGC=100 đổi RAM lấy ít GC; GOMEMLIMIT (Go 1.19+) đặt trần mềm để tránh OOM khi live heap lớn.' },
  { topic: 'concurrency', t: 'mc', q: 'Fan-out 10 goroutine gọi 10 service; một cái lỗi thì muốn huỷ phần còn lại và trả về lỗi đầu tiên. Công cụ chuẩn trong Go?',
    o: ['errgroup.WithContext: g.Go cho từng call, ctx bị cancel khi có lỗi đầu tiên, g.Wait trả lỗi đó', 'sync.WaitGroup + channel error tự viết', 'select với default', 'recover trong mỗi goroutine'], a: 0,
    why: 'WaitGroup + channel làm được nhưng dễ sai (leak goroutine, quên cancel); errgroup gói đúng ngữ nghĩa và có SetLimit để bound concurrency.' },
  { topic: 'cloud', t: 'mc', q: 'Lambda xử lý batch enrichment lớn chạm giới hạn thời gian và bị kill giữa chừng, để lại các dòng kẹt ở trạng thái processing. Thiết kế lại?',
    o: ['Tăng timeout lên tối đa', 'Chia batch nhỏ, checkpoint tiến độ sau mỗi phần, dùng lease/visibility timeout để dòng kẹt được nhận lại, xử lý idempotent để resume an toàn', 'Chuyển sang EC2', 'Giảm số dòng cần xử lý'], a: 1,
    why: 'Mọi job có thể chết bất kỳ lúc nào; thiết kế để chết giữa chừng là vô hại (idempotent + lease hết hạn thì người khác tiếp tục).' },
  { topic: 'data', t: 'mc', q: 'Aggregator đếm click theo phút cho kết quả gấp đôi sau khi worker restart. Nguyên nhân khả dĩ nhất?',
    o: ['Clock skew', 'Trùng ad_id trong dữ liệu', 'Consumer xử lý lại message sau offset chưa commit (at-least-once) trong khi aggregator cộng dồn không idempotent; cần upsert theo (window, ad_id) hoặc commit offset cùng kết quả trong một transaction', 'Window quá nhỏ'], a: 2,
    why: 'Restart = redelivery; phép cộng dồn là thao tác không idempotent nên phải dedupe theo event id hoặc ghi kết quả thay vì cộng thêm.' },
  { topic: 'realtime', t: 'mc', q: 'Hệ thống giữ 1 triệu WebSocket; rolling deploy làm toàn bộ client reconnect cùng lúc, LB và auth service sập (thundering herd). Giải pháp?',
    o: ['Tắt WebSocket, dùng polling', 'Chỉ deploy ban đêm', 'Tăng gấp đôi số server', 'Client reconnect với exponential backoff + jitter; server drain dần (gửi close có kiểm soát theo lô); LB nhận biết số connection để phân bổ'], a: 3,
    why: 'Kết nối bền biến deploy thành sự kiện tải đỉnh; phải trải reconnect theo thời gian từ cả hai phía client và server.' },
  { topic: 'consistency', t: 'mc', q: 'Trong 2PC, coordinator chết ngay sau khi mọi participant đã vote yes nhưng chưa nhận quyết định commit/abort. Participant làm gì?',
    o: ['Tự commit vì đã vote yes', 'Tự abort để an toàn', 'Bỏ qua transaction', 'Phải giữ khoá và chờ coordinator hồi phục để biết quyết định (blocking); đây là điểm yếu cốt lõi của 2PC'], a: 3,
    why: 'Participant không biết các participant khác vote gì nên không tự quyết được; vì vậy hệ phân tán hiện đại tránh 2PC qua ranh giới service.' },
  { topic: 'design', t: 'mc', q: 'Thiết kế đánh giá policy cho 10 000 tenant × 200 policy mỗi 15 phút mà không ghim DB. Nguyên tắc ưu tiên?',
    o: ['Tăng vCPU cho DB', 'Event-driven incremental: chỉ đánh giá lại khi dữ liệu liên quan thay đổi, batch theo tenant, precompute/materialize số liệu dùng chung, bounded concurrency và rate limit theo tenant', 'Chạy mỗi 1 phút với lô nhỏ hơn', 'Cache kết quả 15 phút rồi tính lại'], a: 1,
    why: 'Tính lại toàn bộ theo lịch là O(tenant × policy) bất kể có gì thay đổi; chuyển sang chỉ tính phần đổi giảm công việc hàng trăm lần và tránh one-shot wipe.' }
]}
];

/* ===== ORAL: 90 câu hỏi nhanh, trả lời miệng 2 phút. 18 topic x 5 câu, level 1-3 ===== */
window.ORAL = [
{ id: 'O1', topic: 'net', level: 1, q: 'Walk me through what happens when you type a URL into the browser and press Enter. — Chuyện gì xảy ra từ lúc gõ URL đến khi trang hiện ra?', a: `
- **DNS**: resolver tra tên miền → IP (cache browser/OS/resolver, TTL).
- **TCP** 3-way handshake (1 RTT) → **TLS** handshake (1 RTT với TLS 1.3) → kết nối an toàn.
- Gửi **HTTP request**; LB L7 route tới server; server đọc cache/DB; trả response (có thể qua CDN cho tài nguyên tĩnh).
- Browser parse HTML, tải thêm CSS/JS/ảnh (HTTP/2 multiplex trên cùng kết nối), render.
- Điểm ghi điểm: nêu số RTT, vai trò cache ở từng tầng, keep-alive để tránh lặp handshake.
EN: "Let me go layer by layer, starting with DNS resolution and ending with rendering."` },
{ id: 'O2', topic: 'net', level: 1, q: 'Explain the difference between L4 and L7 load balancing. — Khác nhau giữa cân bằng tải tầng 4 và tầng 7?', a: `
- **L4** nhìn IP/port, chuyển gói TCP/UDP; rất nhanh, không hiểu nội dung, không terminate TLS.
- **L7** hiểu HTTP: route theo path/header/cookie, terminate TLS, retry, rate limit, sticky session, WAF.
- Trả giá: L7 tốn CPU hơn và thêm độ trễ ~ms; L4 không làm được canary theo header.
- Thực tế: L4 ở biên (NLB) → L7 (nginx/ALB/Envoy) trước cụm app.
EN: "The key distinction is what the balancer can see: L4 sees connections, L7 sees requests."` },
{ id: 'O3', topic: 'net', level: 2, q: 'How would you reduce latency for users on another continent? — Giảm độ trễ cho người dùng ở châu lục khác thế nào?', a: `
- Nhận diện vấn đề: RTT liên lục địa ~150 ms, mỗi handshake nhân lên 2-3 lần.
- **CDN/edge** cho nội dung tĩnh và cache API đọc nhiều; **anycast DNS**.
- Giảm số round trip: HTTP/2-3, TLS 1.3, keep-alive, gộp request, 0-RTT resumption.
- Đưa compute gần người dùng: **regional deployment**, read replica theo region; ghi vẫn về primary (hoặc multi-primary nếu chấp nhận conflict).
- Đo trước bằng RUM/synthetic từ region đó, đừng đoán.
EN: "First I would measure where the time goes: round trips, server time, or payload size."` },
{ id: 'O4', topic: 'net', level: 2, q: 'What happens if DNS TTL is set very low versus very high? — TTL DNS rất thấp hoặc rất cao gây gì?', a: `
- **TTL cao** (giờ/ngày): ít query DNS, nhưng đổi IP/failover mất hàng giờ mới lan tới client; một số resolver còn bỏ qua TTL.
- **TTL thấp** (30-60 s): failover nhanh, đổi lại tải lên DNS tăng và mỗi lần hết TTL thêm ~20-100 ms resolve.
- Thực hành: hạ TTL vài ngày trước khi đổi IP; failover thật nên làm ở LB/anycast chứ không trông vào DNS.
- Lưu ý client giữ IP cũ (JVM, pool kết nối) bất kể TTL.
EN: "TTL is a trade-off between DNS load and how fast a change propagates."` },
{ id: 'O5', topic: 'net', level: 3, q: 'When would you NOT use gRPC, and what problem does HTTP/3 solve that HTTP/2 does not? — Khi nào không nên dùng gRPC; HTTP/3 giải quyết gì mà HTTP/2 chưa?', a: `
- Không dùng gRPC khi: client là browser hoặc đối tác bên ngoài (cần REST/JSON dễ debug, proxy/firewall thân thiện), API public cần cache HTTP, team không muốn quản lý schema protobuf.
- Dùng gRPC cho service-to-service nội bộ: contract chặt, streaming, nhỏ và nhanh.
- HTTP/2 multiplex nhiều stream trên một TCP → hết HOL ở tầng HTTP, nhưng **TCP HOL** vẫn còn: mất một gói chặn mọi stream.
- HTTP/3 (QUIC trên UDP) đưa stream xuống transport, mất gói chỉ chặn stream đó, handshake 1-RTT/0-RTT, chuyển mạng không rớt kết nối.
EN: "gRPC shines inside the data center; at the edge I would still expose REST or GraphQL."` },
{ id: 'O6', topic: 'os', level: 1, q: 'Explain the difference between a process and a thread. — Khác nhau giữa process và thread?', a: `
- **Process**: không gian địa chỉ riêng, fd riêng, cách ly bởi kernel; chết không kéo process khác theo.
- **Thread**: chạy trong process, chia sẻ heap/global/fd, có stack và registers riêng; tạo và chuyển ngữ cảnh rẻ hơn process.
- Giao tiếp: process qua IPC (socket, pipe, shared memory); thread qua bộ nhớ chung → cần đồng bộ (mutex, atomic).
- Liên hệ Go: goroutine là green thread do runtime lập lịch M:N lên OS thread.
EN: "A process is the unit of isolation; a thread is the unit of scheduling inside it."` },
{ id: 'O7', topic: 'os', level: 2, q: 'What happens when a container exceeds its memory limit, and how do you detect it? — Container vượt giới hạn bộ nhớ thì sao, phát hiện thế nào?', a: `
- Có **memory limit**: cgroup OOM killer giết process trong container, [[docker inspect]] thấy OOMKilled=true, exit code 137.
- **Không có limit**: container ăn RAM host; kernel OOM killer toàn cục giết process lớn nhất, OOMKilled=false, chỉ thấy trong [[dmesg]]/journal của host.
- Phát hiện: metric container_memory_working_set, alert gần limit, restart count, dmesg.
- Phòng: luôn đặt limit, Go đặt GOMEMLIMIT, giới hạn dữ liệu nạp vào RAM (phân trang, stream).
EN: "The tricky case is a container without a limit: it gets killed by the host and Docker never records it."` },
{ id: 'O8', topic: 'os', level: 2, q: 'Explain how the OS page cache affects write durability. — Page cache ảnh hưởng độ bền của ghi dữ liệu thế nào?', a: `
- [[write()]] chỉ chép dữ liệu vào **page cache** trong RAM và trả về; kernel flush xuống đĩa sau (vài giây).
- Mất điện trước khi flush → mất dữ liệu dù ứng dụng đã thấy ghi thành công.
- [[fsync()]] ép flush và chờ đĩa xác nhận: đắt (~ms trên SSD) nên DB chỉ fsync WAL theo nhóm (group commit).
- Đọc cũng hưởng lợi: file nóng nằm trong page cache, đó là lý do Kafka/Postgres dựa vào OS cache thay vì tự quản hết.
EN: "Durability is only guaranteed after fsync, which is exactly why commits are expensive."` },
{ id: 'O9', topic: 'os', level: 3, q: 'How would you diagnose a service with high CPU but low throughput? — Service CPU cao nhưng throughput thấp, chẩn đoán thế nào?', a: `
- Phân loại: CPU user hay sys? [[top]]/[[pidstat]]; sys cao → syscall/context switch/GC nhiều.
- Profile ứng dụng: Go [[pprof]] CPU profile 30 s → hàm nóng (serialization, regex, lock contention, GC mark).
- Kiểm tra **lock contention** (mutex profile), **context switch** quá nhiều thread, **CFS throttling** trong container (GOMAXPROCS lệch quota).
- Kiểm tra vòng lặp busy-wait, retry storm, log đồng bộ quá nhiều.
- Đối chiếu throughput với tải vào: có thể CPU đi vào việc vô ích (cache miss 100%, query lặp N+1).
EN: "I would start with a CPU profile to see whether the time is useful work or overhead."` },
{ id: 'O10', topic: 'os', level: 3, q: 'How would you design a server that holds 100k concurrent connections? — Thiết kế server giữ 100 nghìn kết nối đồng thời thế nào?', a: `
- Không thể 1 thread/kết nối (100k × 1 MB stack, context switch). Dùng **event loop** (epoll/kqueue) hoặc runtime M:N như Go (goroutine vài KB).
- Nâng giới hạn OS: ulimit -n, net.core.somaxconn, port range, TIME_WAIT reuse.
- Bộ nhớ: mỗi kết nối vài chục KB buffer → 100k ≈ vài GB; giới hạn buffer, timeout idle.
- Tránh thundering herd khi reconnect; health check và drain khi deploy.
- Scale ngang: LB L4 phân kết nối, state (session/presence) đặt ở Redis.
EN: "The constraint is per-connection memory and scheduling cost, not raw CPU."` },
{ id: 'O11', topic: 'db', level: 1, q: 'Explain how a B-tree index speeds up reads and what it costs on writes. — Index B-tree giúp đọc nhanh thế nào và tốn gì khi ghi?', a: `
- Cây cân bằng, mỗi node là một page; tìm key trong O(log n) với 3-4 lần đọc page cho hàng trăm triệu dòng.
- Hỗ trợ bằng, khoảng, ORDER BY theo thứ tự index; **covering index** tránh đọc bảng.
- Chi phí: mỗi INSERT/UPDATE/DELETE cập nhật từng index → ghi chậm hơn, WAL nhiều hơn, tốn đĩa và RAM cache.
- Index không được dùng khi: hàm trên cột, cột đầu composite không có trong WHERE, selectivity thấp.
- Thực hành: luôn EXPLAIN ANALYZE; partial index cho tập nhỏ (status = pending).
EN: "An index trades write cost and space for logarithmic reads."` },
{ id: 'O12', topic: 'db', level: 1, q: 'Why do too many connections hurt Postgres, and what is a connection pooler for? — Vì sao quá nhiều kết nối làm Postgres chậm; pooler để làm gì?', a: `
- Mỗi connection Postgres là một **process** riêng (~5-10 MB; đo PSS ≈ 7–8 MiB, ~1–2 MiB với huge_pages — RSS trong ps phóng đại vì shared memory), tranh CPU và lock nội bộ; vài trăm là ngưỡng thường thấy.
- Nhiều app × pool lớn = hàng nghìn connection → too many clients, context switch, hiệu năng giảm chứ không tăng.
- **PgBouncer/pgcat** gom hàng nghìn client vào vài chục connection thật; transaction mode hiệu quả nhất nhưng mất session state (SET, prepared statement).
- Quy tắc: tổng pool ≈ số core × 2-4; đo chờ kết nối thay vì tăng pool.
EN: "Postgres connections are heavyweight processes, so we pool them in front of the database."` },
{ id: 'O13', topic: 'db', level: 2, q: 'Explain the difference between Read Committed and Repeatable Read, and when it matters. — Khác nhau giữa Read Committed và Repeatable Read, khi nào quan trọng?', a: `
- **Read Committed** (mặc định Postgres): mỗi câu lệnh thấy snapshot mới nhất đã commit → cùng tx đọc hai lần có thể khác (non-repeatable read).
- **Repeatable Read**: toàn tx dùng một snapshot; đọc ổn định, nhưng UPDATE lên dòng đã bị tx khác đổi sẽ lỗi serialization → phải retry.
- Quan trọng khi: báo cáo nhiều query cần nhất quán, read-modify-write (số dư, tồn kho).
- Không isolation nào thay được khoá/constraint cho check-then-act; dùng FOR UPDATE, unique constraint hoặc version column.
EN: "The default is Read Committed, so every statement can see a different snapshot."` },
{ id: 'O14', topic: 'db', level: 2, q: 'How would you add an index to a 100-million-row table in production without downtime? — Thêm index cho bảng 100 triệu dòng đang chạy mà không downtime?', a: `
- [[CREATE INDEX CONCURRENTLY]]: không chặn ghi, quét bảng hai lần, chậm hơn, không chạy trong transaction.
- Kiểm tra sau khi xong: index có thể INVALID nếu lỗi giữa chừng → drop và tạo lại.
- Chạy giờ thấp điểm, theo dõi IO và replication lag; trên replica logical cần tạo riêng.
- Nếu là migration tự động: tách bước tạo index khỏi migration có tx; đặt lock_timeout ngắn để không treo hàng đợi lock.
- Cân nhắc partial index nếu chỉ query một tập con.
EN: "I would use CREATE INDEX CONCURRENTLY and verify the index is valid afterwards."` },
{ id: 'O15', topic: 'db', level: 3, q: 'When would you NOT use a relational database? — Khi nào không nên dùng cơ sở dữ liệu quan hệ?', a: `
- Ghi cực lớn phân tán theo key, không cần JOIN/tx đa dòng: time series, event log, session → KV/wide-column/TSDB.
- Dữ liệu blob lớn → object storage; full-text/geo nặng → search engine chuyên dụng.
- Cần scale ghi ngang vượt một primary mà không muốn tự shard → Cassandra/DynamoDB (chấp nhận eventual consistency, truy vấn theo access pattern định trước).
- Graph sâu nhiều bước → graph DB.
- Nhưng: Postgres đi rất xa (JSONB, partition, PostGIS, full-text); đừng bỏ RDBMS chỉ vì nghe scale.
EN: "I default to Postgres until a specific access pattern or write volume proves it is the wrong tool."` },
{ id: 'O16', topic: 'cache', level: 1, q: 'Explain cache-aside and its main consistency problem. — Giải thích cache-aside và vấn đề nhất quán chính của nó.', a: `
- Đọc: tra cache → miss → đọc DB → ghi vào cache với TTL → trả về. Ghi: cập nhật DB rồi **xoá** key cache.
- Vấn đề: giữa lúc xoá cache và lần đọc tiếp theo có thể có request đọc DB cũ rồi ghi lại cache (race) → stale cho đến hết TTL.
- Giảm thiểu: TTL ngắn hợp lý, xoá sau ghi (delete-after-write), double delete có trễ, hoặc version trong key.
- Ưu điểm: đơn giản, cache chết thì hệ vẫn chạy (chậm hơn); chỉ cache dữ liệu được đọc.
EN: "Cache-aside is simple, but invalidation races mean it is eventually consistent by nature."` },
{ id: 'O17', topic: 'cache', level: 2, q: 'What happens if many cache keys expire at the same time, and how do you prevent it? — Nhiều key cache hết hạn cùng lúc thì sao, phòng thế nào?', a: `
- **Cache avalanche**: hàng loạt miss đồng thời dồn xuống DB, DB chậm → thêm miss → sập dây chuyền.
- Nguyên nhân: warm-up cùng lúc, TTL cố định, restart Redis, deploy đổi key.
- Phòng: **TTL + jitter** ngẫu nhiên 10-20%; **single-flight** cho mỗi key; stale-while-revalidate (trả bản cũ, refresh nền); warm-up dần; circuit breaker trước DB.
- Với key cực nóng: không cho hết hạn, refresh chủ động bằng job.
EN: "The fix is to spread expirations with jitter and let only one request rebuild a key."` },
{ id: 'O18', topic: 'cache', level: 2, q: 'How would you handle a hot key in Redis? — Xử lý hot key trong Redis thế nào?', a: `
- Dấu hiệu: một shard CPU cao, các shard khác rảnh; [[redis-cli --hotkeys]] hoặc metric theo key.
- **Local cache** trong process (TTL vài giây) chặn phần lớn đọc trước khi tới Redis.
- **Nhân bản key**: key#1..key#N trên nhiều shard, client chọn ngẫu nhiên khi đọc, ghi cả N.
- Tách dữ liệu lớn thành phần nhỏ; dùng read replica của Redis cho đọc.
- Cân nhắc đổi thiết kế: bảng xếp hạng toàn cục có thể tính sẵn và push.
EN: "Adding shards does not help a hot key; I have to split the key itself or cache it locally."` },
{ id: 'O19', topic: 'cache', level: 3, q: 'How do you keep cache and database consistent on update: update or delete the cache, and in what order? — Cập nhật dữ liệu thì cache nên update hay delete, thứ tự ra sao?', a: `
- Ưu tiên **xoá** thay vì update cache: update dễ ghi đè bằng giá trị cũ khi hai writer đua nhau và tốn công tính dữ liệu không ai đọc.
- Thứ tự: **ghi DB trước, xoá cache sau**. Xoá trước có cửa sổ lớn: request khác đọc DB cũ và nạp lại cache cũ.
- Vẫn còn race hiếm (đọc miss → DB cũ → ghi DB mới → xoá → ghi cache cũ); giảm bằng TTL, delayed double delete, hoặc CDC đẩy invalidation từ WAL.
- Nếu cần mạnh hơn: write-through có khoá, hoặc version/ETag trong key.
EN: "Write to the database first, then delete the cache entry, and accept a short inconsistency window."` },
{ id: 'O20', topic: 'cache', level: 3, q: 'When would you NOT add a cache, and how do you prove a cache is worth it? — Khi nào không nên thêm cache, chứng minh cache đáng giá thế nào?', a: `
- Không cache khi: dữ liệu đổi liên tục hoặc mỗi request một khác (hit rate thấp), yêu cầu đọc mới nhất tuyệt đối (số dư), DB còn thừa sức và vấn đề thật là query thiếu index.
- Cache thêm **một thành phần phải vận hành**, thêm bug nhất quán, thêm chế độ lỗi (cache sập → DB sập theo).
- Chứng minh: đo hit rate, p99 trước/sau, tải DB giảm bao nhiêu; ước lượng RAM = số key × kích thước × hệ số.
- Thử rẻ trước: index, query tối ưu, connection pool, HTTP cache header.
EN: "A cache is a performance optimization with a consistency cost, so I want numbers before adding one."` },
{ id: 'O21', topic: 'queue', level: 1, q: 'Why would you put a message queue between two services? — Vì sao đặt message queue giữa hai service?', a: `
- **Decouple**: producer không cần consumer sống; deploy, scale độc lập.
- **Buffer đỉnh tải**: hấp thụ burst, consumer xử lý theo tốc độ của mình (backpressure).
- **Fan-out**: một event nhiều consumer; retry/DLQ có sẵn.
- Trả giá: eventual consistency, phải xử lý trùng (at-least-once), thêm hệ thống phải vận hành, khó debug luồng.
- Không dùng khi cần phản hồi đồng bộ ngay cho người dùng.
EN: "A queue buys decoupling and burst absorption at the cost of asynchrony and duplicate handling."` },
{ id: 'O22', topic: 'queue', level: 1, q: 'Explain at-most-once, at-least-once and exactly-once delivery. — Giải thích ba ngữ nghĩa giao message.', a: `
- **At-most-once**: gửi và quên, có thể mất, không trùng (ack trước khi xử lý).
- **At-least-once**: ack sau khi xử lý xong; retry khi lỗi → có thể trùng. Đây là mặc định an toàn.
- **Exactly-once**: không tồn tại end-to-end trên mạng không tin cậy; đạt bằng at-least-once + **consumer idempotent** (dedupe theo message id, upsert).
- Kafka transactions chỉ exactly-once trong phạm vi Kafka → Kafka.
EN: "In practice I design for at-least-once and make the consumer idempotent."` },
{ id: 'O23', topic: 'queue', level: 2, q: 'What happens if a consumer crashes mid-processing, and what about a poison message? — Consumer chết giữa chừng thì sao; poison message xử lý thế nào?', a: `
- Chưa ack → broker redeliver cho consumer khác sau khi connection đứt (RabbitMQ) hoặc offset chưa commit được đọc lại (Kafka) → **xử lý trùng** → cần idempotent.
- Hiệu ứng phụ đã làm một nửa (gọi API ngoài) phải được thiết kế để lặp lại an toàn.
- **Poison message**: lỗi lặp vô hạn, chặn hàng đợi. Giới hạn retry (header x-death/attempt), backoff, chuyển **DLQ**, alert, sửa tay rồi replay.
- Giữ prefetch nhỏ để message không kẹt ở consumer chết lâu.
EN: "A crash means redelivery, so the consumer must tolerate seeing the same message twice."` },
{ id: 'O24', topic: 'queue', level: 2, q: 'Compare RabbitMQ and Kafka: when would you choose each? — So sánh RabbitMQ và Kafka, chọn cái nào khi nào?', a: `
- **RabbitMQ**: smart broker, routing linh hoạt (exchange, routing key), per-message ack, ưu tiên, TTL, DLQ; message xoá sau ack → hợp task queue, RPC bất đồng bộ, hàng đợi công việc.
- **Kafka**: dumb broker, log append-only theo partition, consumer giữ offset, retention theo thời gian → replay, nhiều consumer group độc lập, throughput rất cao, ordering theo partition; hợp event streaming, CDC, analytics.
- Kafka vận hành nặng hơn (ZooKeeper/KRaft, partition planning); RabbitMQ không replay được.
- SBOM: job queue → RabbitMQ đủ; audit/event sourcing cần replay → Kafka.
EN: "If I need replay and multiple independent readers, Kafka; if I need rich routing and work queues, RabbitMQ."` },
{ id: 'O25', topic: 'queue', level: 3, q: 'How would you guarantee that a database write and an event publish are consistent? — Đảm bảo ghi DB và publish event nhất quán thế nào?', a: `
- Vấn đề dual write: commit rồi publish → crash giữa chừng mất event; publish rồi commit → consumer thấy event trước dữ liệu (FK lỗi, mất log).
- **Transactional outbox**: ghi event vào bảng outbox trong cùng tx; relay (poller hoặc CDC/Debezium đọc WAL) publish rồi đánh dấu đã gửi.
- Relay là at-least-once → consumer **idempotent** theo event id.
- Tránh 2PC giữa DB và broker: chậm, blocking, ít broker hỗ trợ.
- Theo dõi: độ trễ outbox, số event chưa gửi.
EN: "I would use the transactional outbox pattern so the event is committed atomically with the data."` },
{ id: 'O26', topic: 'api', level: 1, q: 'What makes an API idempotent, and why does it matter for retries? — API idempotent là gì, vì sao quan trọng khi retry?', a: `
- Gọi N lần cho cùng kết quả và cùng trạng thái như gọi 1 lần: GET, PUT, DELETE theo định nghĩa; POST thì không.
- Timeout không cho biết server đã xử lý hay chưa → client **phải retry** → không idempotent thì tạo trùng (tính tiền 2 lần).
- Cách làm POST idempotent: **Idempotency-Key** header, server lưu (key → kết quả) với TTL, trả lại kết quả cũ khi gặp lại key; unique constraint theo business key.
- Áp dụng cả cho consumer queue và webhook.
EN: "Idempotency lets clients retry safely, which is the only sane response to a timeout."` },
{ id: 'O27', topic: 'api', level: 2, q: 'How would you design pagination for a very large list endpoint? — Thiết kế phân trang cho endpoint danh sách rất lớn?', a: `
- Tránh OFFSET ở trang sâu: O(N) quét bỏ, kết quả trôi khi có insert/delete.
- **Keyset/cursor**: sort theo (created_at, id) ổn định; cursor mã hoá giá trị cuối trang (opaque base64); WHERE (created_at, id) < (cursor) LIMIT n+1 để biết còn trang.
- Không trả total count mỗi trang (COUNT đắt); trả has_more hoặc ước lượng.
- Giới hạn page size (max 100-200), filter phải nằm trong index cùng sort key.
- Export lớn → stream/async job + file, không phân trang API.
EN: "I would use cursor-based pagination keyed on an indexed, stable sort order."` },
{ id: 'O28', topic: 'api', level: 2, q: 'How would you evolve an API without breaking existing clients? — Thay đổi API mà không làm hỏng client cũ thế nào?', a: `
- Quy tắc **additive**: thêm field optional có default, không đổi nghĩa/kiểu field cũ, không xoá; client phải bỏ qua field lạ (tolerant reader).
- Breaking change → version mới (/v2 hoặc header), chạy song song, deprecate có hạn, đo client còn gọi v1.
- Contract test / OpenAPI diff trong CI để bắt breaking change sớm.
- Với gRPC: không đổi số field protobuf, không tái dùng số đã xoá.
- Feature flag phía server để bật dần.
EN: "Backward compatibility is the default; a new version is the exception when I truly must break the contract."` },
{ id: 'O29', topic: 'api', level: 3, q: 'Compare token bucket and sliding window rate limiting, and how would you make it work across many gateway instances? — So sánh token bucket và sliding window; làm sao chạy đúng trên nhiều instance?', a: `
- **Token bucket**: nạp r token/giây, dung lượng b → cho burst tới b, trung bình r; nhớ 2 số (tokens, last_ts) nên rẻ.
- **Sliding window log** chính xác nhưng tốn RAM theo số request; **sliding window counter** nội suy hai cửa sổ, gần đúng và rẻ.
- Fixed window có lỗ hổng 2× ở biên; leaky bucket làm phẳng, không cho burst.
- Phân tán: counter ở **Redis** với Lua script atomic (đọc-tính-ghi một lần), key theo (client, route); chấp nhận sai số nhỏ, fail-open hay fail-closed phải quyết định trước.
- Trả 429 + Retry-After, header X-RateLimit-Remaining.
EN: "Token bucket is my default because it allows controlled bursts and stores almost no state."` },
{ id: 'O30', topic: 'api', level: 3, q: 'How would you design a webhook delivery system customers can trust? — Thiết kế hệ thống gửi webhook mà khách hàng tin cậy được?', a: `
- Lưu event bền (outbox) rồi worker gửi bất đồng bộ; **at-least-once** với event id để khách dedupe.
- **Retry** exponential backoff + jitter trong vài giờ/ngày, timeout ngắn (5-10 s), sau N lần → DLQ + thông báo cho khách, cho phép replay thủ công.
- **Ký HMAC** payload với secret theo khách + timestamp chống replay; khách verify.
- Cách ly: endpoint chậm của một khách không chặn khách khác (queue/partition theo khách, circuit breaker).
- Quan sát: dashboard trạng thái gửi cho khách, log response code.
EN: "A trustworthy webhook system is durable, retried with backoff, signed, and idempotent on the receiving side."` },
{ id: 'O31', topic: 'scale', level: 1, q: 'Explain horizontal versus vertical scaling, and what makes an application horizontally scalable. — Scale ngang và dọc khác nhau gì; điều kiện để scale ngang?', a: `
- **Vertical**: máy to hơn; đơn giản, không đổi code, nhưng có trần, đắt phi tuyến, vẫn SPOF.
- **Horizontal**: thêm máy; gần như vô hạn, chịu lỗi, nhưng đòi hỏi app **stateless** và dữ liệu phân tán.
- Điều kiện: session/file ở store chung (Redis, S3), không dựa vào local disk/memory, cấu hình qua env, health check để LB loại node hỏng.
- DB là phần khó scale ngang nhất → replica cho đọc, shard cho ghi.
EN: "Scale up until it hurts, but design the application stateless from day one so scaling out is possible."` },
{ id: 'O32', topic: 'scale', level: 1, q: 'What does a load balancer do, and which algorithm would you pick? — Load balancer làm gì, chọn thuật toán nào?', a: `
- Phân phối request lên nhiều backend, health check loại node hỏng, terminate TLS, đôi khi rate limit và sticky session.
- **Round-robin** đơn giản cho node đồng đều; **weighted** khi năng lực khác nhau; **least connections** khi request dài ngắn khác nhau; **consistent hash** khi cần cùng key về cùng node (cache cục bộ).
- Mặc định của tôi: least connections có weight, cộng health check tích cực.
- LB chính nó phải HA: cặp active-passive hoặc anycast/DNS nhiều LB.
EN: "I would pick least-connections with health checks unless I need request affinity."` },
{ id: 'O33', topic: 'scale', level: 2, q: 'Explain consistent hashing and why it beats hash mod N. — Giải thích consistent hashing và vì sao hơn hash mod N.', a: `
- hash mod N: thêm/bớt một node đổi vị trí ~N/(N+1) key (4 → 5 node: 80%) → cache lạnh toàn bộ.
- **Consistent hashing**: node và key cùng hash lên vòng tròn; key thuộc node đầu tiên theo chiều kim đồng hồ; thêm node chỉ di chuyển ~1/(N+1) key.
- **Virtual node** (100-200 điểm mỗi node vật lý) làm phân bố đều và cho phép weight.
- Dùng ở: cache cluster, Cassandra/Dynamo partition, LB request affinity, sharding.
- Hạn chế: rebalance khi dữ liệu lệch vẫn cần di chuyển; hot key không được giải quyết.
EN: "Consistent hashing minimizes key movement when the cluster size changes."` },
{ id: 'O34', topic: 'scale', level: 2, q: 'How would you choose a shard key, and what goes wrong with a bad one? — Chọn shard key thế nào; key xấu gây gì?', a: `
- Tiêu chí: **cardinality cao**, phân bố đều ghi và đọc, query phổ biến chứa key đó (tránh scatter-gather), ổn định không đổi.
- Ví dụ tốt: user_id/tenant_id hash; xấu: created_at range (hotspot shard mới), country (lệch), boolean.
- Tenant lớn → hot shard: tách tenant lớn riêng hoặc shard phụ theo (tenant, time).
- Hậu quả key xấu: một shard quá tải, query đụng mọi shard, không rebalance được, JOIN xuyên shard.
- Đổi shard key gần như là migration lại toàn bộ dữ liệu → quyết định sớm và cẩn thận.
EN: "A good shard key spreads load evenly and matches the dominant query pattern."` },
{ id: 'O35', topic: 'scale', level: 3, q: 'How would you handle a celebrity or hot-partition problem? — Xử lý bài toán celebrity / hot partition thế nào?', a: `
- Nhận diện: một key/partition nhận lượng truy cập vượt xa phần còn lại (user 10 triệu follower, tenant 80% dữ liệu).
- Feed: **hybrid fan-out** — fan-out on write cho user thường, fan-out on read cho celebrity, merge lúc đọc.
- Dữ liệu: tách entity nóng ra partition/DB riêng (isolation tier), sub-partition theo thời gian, cache nhiều lớp, nhân bản key.
- Hàng đợi: partition key thêm salt cho tenant lớn (tenant#0..#k), đổi lại mất ordering toàn tenant.
- Quan sát theo key: top-k key theo QPS để phát hiện sớm.
EN: "Hot keys need a different strategy than the rest of the data, not more of the same hardware."` },
{ id: 'O36', topic: 'consistency', level: 1, q: 'Explain the CAP theorem in practical terms. — Giải thích CAP một cách thực dụng.', a: `
- Khi mạng **partition** (chắc chắn xảy ra), phải chọn: trả lời có thể cũ (**AP**) hay từ chối/chờ (**CP**).
- Không có partition thì trade-off thật là **latency vs consistency** (PACELC).
- Ví dụ: DNS, Cassandra mặc định AP; ZooKeeper/etcd, Postgres sync replica là CP.
- Thực tế chọn theo từng thao tác: số dư/booking cần CP, like/view count chấp nhận AP.
- Tránh nói "chọn 2 trong 3": P không phải lựa chọn.
EN: "CAP is really about what the system does during a network partition: stay consistent or stay available."` },
{ id: 'O37', topic: 'consistency', level: 2, q: 'Explain quorum reads and writes with N, R and W. — Giải thích quorum đọc/ghi với N, R, W.', a: `
- N bản sao; ghi thành công khi **W** node ack; đọc hỏi **R** node lấy bản mới nhất (theo version).
- **R + W > N** → tập đọc và ghi luôn giao nhau → đọc thấy ghi mới nhất (strong-ish). Ví dụ N=3, W=2, R=2.
- W=1, R=1: nhanh, availability cao, có thể đọc cũ. W=N: ghi chậm, một node chết là không ghi được.
- Kèm theo: read repair, hinted handoff (sloppy quorum làm mất tính giao nhau), anti-entropy.
- Chỉnh theo thao tác: ghi quan trọng W cao, đọc nóng R thấp.
EN: "As long as R plus W exceeds N, every read overlaps the latest write."` },
{ id: 'O38', topic: 'consistency', level: 2, q: 'What is the difference between eventual and strong consistency? Give a real example of each. — Khác nhau giữa eventual và strong consistency, ví dụ thật?', a: `
- **Strong** (linearizable): mọi đọc sau khi ghi thành công đều thấy giá trị mới, như một bản duy nhất. Ví dụ: primary Postgres, etcd, số dư tài khoản.
- **Eventual**: tạm thời có thể đọc cũ, cuối cùng hội tụ. Ví dụ: DNS, read replica async, S3 trước 2020, feed mạng xã hội.
- Mức giữa: read-your-writes, monotonic reads, causal — thường là thứ người dùng thực sự cần.
- Chi phí strong: latency (round trip quorum), availability khi partition.
- SBOM: trạng thái enrichment eventual là ổn; license đã mua/role phải strong.
EN: "Most systems need strong consistency for a few operations and can tolerate eventual for the rest."` },
{ id: 'O39', topic: 'consistency', level: 3, q: 'How would you implement a transaction spanning two services without two-phase commit? — Làm transaction xuyên hai service mà không dùng 2PC?', a: `
- **Saga**: chuỗi transaction cục bộ; bước sau lỗi → chạy **compensating transaction** hoàn tác bước trước (refund, release stock).
- Hai kiểu: choreography (event, đơn giản, khó theo dõi) và orchestration (một coordinator giữ state machine, dễ debug).
- Yêu cầu: mỗi bước idempotent, có event id, outbox để publish tin cậy, timeout và retry rõ ràng.
- Chấp nhận trạng thái trung gian nhìn thấy được (đơn pending); thiết kế UI/API theo đó.
- Không bù được (gửi email) → đặt cuối chuỗi.
EN: "I would model it as a saga with explicit compensating actions and an orchestrator for visibility."` },
{ id: 'O40', topic: 'consistency', level: 3, q: 'Explain how Raft elects a leader and why you need 2f+1 nodes. — Raft bầu leader thế nào, vì sao cần 2f+1 node?', a: `
- Node ở trạng thái follower; không nhận heartbeat trong election timeout (ngẫu nhiên 150-300 ms) → thành candidate, tăng **term**, xin vote.
- Đa số vote → leader; mỗi node chỉ vote một lần mỗi term và chỉ cho candidate có log không cũ hơn mình.
- Ghi: leader append log, replicate, commit khi **đa số** ack → entry không bao giờ mất khi đổi leader.
- Cần đa số để hai leader không cùng tồn tại một term và để tập commit luôn giao với tập bầu: chịu f lỗi cần 2f+1 node (3 chịu 1, 5 chịu 2).
- Dùng trong etcd, Consul, CockroachDB; chậm hơn primary-replica thường nên chỉ cho metadata/coordination.
EN: "Raft needs a majority both to elect a leader and to commit, so f failures require 2f plus 1 nodes."` },
{ id: 'O41', topic: 'storage', level: 1, q: 'Compare block, file and object storage. — So sánh block, file và object storage.', a: `
- **Block** (EBS, SSD): đĩa thô gắn vào một máy, độ trễ thấp nhất, cho DB; không chia sẻ nhiều máy dễ dàng.
- **File** (NFS, EFS): hệ thống file chia sẻ, POSIX, sửa tại chỗ; scale và hiệu năng giới hạn.
- **Object** (S3, MinIO): key → blob qua HTTP, bền 11 số 9, scale gần vô hạn, rẻ; không sửa một phần, độ trễ ~10-100 ms, eventual listing.
- Chọn: DB → block; upload SBOM/ảnh/video/backup → object; legacy app cần POSIX chung → file.
EN: "Block for databases, object for blobs, file only when I need shared POSIX semantics."` },
{ id: 'O42', topic: 'storage', level: 1, q: 'What is a write-ahead log and why do databases use it? — WAL là gì, vì sao DB dùng?', a: `
- Trước khi sửa trang dữ liệu, DB **append** mô tả thay đổi vào log tuần tự và fsync → commit được công nhận.
- Ghi tuần tự rẻ hơn nhiều ghi ngẫu nhiên vào B-tree; trang dữ liệu flush sau (checkpoint).
- Crash → replay WAL từ checkpoint cuối → không mất dữ liệu đã commit (durability, atomicity).
- WAL còn là nguồn cho **replication** (streaming), **CDC** (Debezium), point-in-time recovery.
- Chi phí: đĩa cho WAL, fsync latency; group commit gộp nhiều tx vào một fsync.
EN: "The WAL turns random writes into sequential ones and is the source of truth for recovery and replication."` },
{ id: 'O43', topic: 'storage', level: 2, q: 'Explain LSM-tree versus B-tree storage engines. — So sánh LSM-tree và B-tree.', a: `
- **B-tree**: cập nhật tại chỗ, đọc nhanh và ổn định (O(log n) page), ghi ngẫu nhiên tốn; Postgres, MySQL InnoDB.
- **LSM**: ghi vào WAL + memtable, flush thành SSTable bất biến, **compaction** gộp nền; ghi tuần tự rất nhanh, nén tốt; đọc phải tra nhiều SSTable (Bloom filter giúp), compaction ăn IO; RocksDB, Cassandra, LevelDB.
- Chọn LSM cho write-heavy (log, time series, event); B-tree cho đọc-ghi cân bằng, nhiều range scan và transaction.
- Amplification: B-tree write amplification cao; LSM read và space amplification cao.
EN: "LSM optimizes for writes with sequential I/O; B-tree optimizes for predictable reads."` },
{ id: 'O44', topic: 'storage', level: 2, q: 'How would you store and serve millions of large files such as SBOM uploads or videos? — Lưu và phục vụ hàng triệu file lớn thế nào?', a: `
- Blob vào **object storage**, DB chỉ giữ metadata (key, size, hash, owner, trạng thái).
- Upload: client lấy **presigned URL** rồi đẩy thẳng lên S3 (multipart cho file lớn, resumable); API không làm proxy byte.
- Phục vụ: presigned GET hoặc **CDN** trước bucket; cache header, range request.
- Dedupe theo content hash; lifecycle chuyển lớp lạnh sau 90 ngày; versioning và xoá mềm.
- Xử lý sau upload bất đồng bộ qua event (S3 notification → queue → worker parse).
EN: "Keep bytes in object storage behind presigned URLs and keep only metadata in the database."` },
{ id: 'O45', topic: 'storage', level: 3, q: 'How would you design delta sync for a Drive-like product? — Thiết kế delta sync cho sản phẩm kiểu Drive?', a: `
- Chia file thành **block** (4 MB cố định hoặc content-defined chunking để chèn giữa file không dịch mọi block); hash SHA-256 từng block.
- Metadata file = danh sách block hash + version; client so sánh hash cục bộ với server, chỉ upload block mới.
- Block store dedupe toàn cục theo hash; file mới = tập hợp con trỏ.
- Đồng bộ: client giữ journal thay đổi, long polling/WebSocket nhận thông báo version mới; conflict → conflict copy theo version vector.
- Chi phí: metadata lớn, CPU hash phía client, consistency giữa metadata DB và block store (ghi block trước, commit metadata sau).
EN: "Delta sync is block-level hashing plus a metadata service that references immutable blocks."` },
{ id: 'O46', topic: 'security', level: 1, q: 'Explain the difference between authentication and authorization. — Khác nhau giữa xác thực và phân quyền?', a: `
- **Authentication** (authn): bạn là ai — mật khẩu, OTP, OIDC/SSO, mTLS, API key.
- **Authorization** (authz): bạn được làm gì — RBAC (role), ABAC (thuộc tính), scope trong token, row-level theo tenant.
- Authn làm ở biên (gateway), authz phải làm ở từng resource; lỗi phổ biến: kiểm tra đăng nhập nhưng quên kiểm tra owner/tenant (IDOR).
- Multi-tenant: mọi query đều phải scope theo tenant_id lấy từ token, không từ request body.
EN: "Authentication proves identity; authorization decides what that identity may do."` },
{ id: 'O47', topic: 'security', level: 2, q: 'How does a JWT work, and what is its biggest weakness? — JWT hoạt động thế nào, điểm yếu lớn nhất?', a: `
- Header.payload.signature; server ký (HMAC hoặc RSA/ECDSA), client gửi kèm mỗi request; server verify chữ ký không cần tra DB → **stateless**, scale tốt.
- Payload chỉ base64, **không mã hoá** → không đặt bí mật trong đó.
- Điểm yếu: **không thu hồi được** trước khi hết hạn; token lộ dùng được tới hết TTL.
- Giảm thiểu: access token ngắn (5-15 phút) + refresh token xoay vòng có thể thu hồi, blocklist jti khi cần, kiểm tra alg (cấm none), audience/issuer.
- Cân nhắc opaque session token nếu cần thu hồi tức thì.
EN: "JWTs scale because they are stateless, and that same property makes revocation hard."` },
{ id: 'O48', topic: 'security', level: 2, q: 'How would you isolate tenant data in a multi-tenant SaaS? — Cách ly dữ liệu tenant trong SaaS thế nào?', a: `
- Ba mức: **bảng chung + tenant_id** (rẻ, dễ leak), **schema riêng**, **DB riêng** (cách ly mạnh nhất, tốn vận hành).
- Với bảng chung: tenant_id từ token gắn vào mọi query qua lớp repository, **row-level security** của Postgres làm lưới an toàn, test tự động thử truy cập chéo tenant.
- Dữ liệu dùng chung (component, license từ nguồn công khai) phải tách khỏi dữ liệu tenant nhập; không để tenant ghi đè dữ liệu chung (first-writer-wins leak) → overlay per-tenant.
- Cách ly tài nguyên: rate limit, queue, connection theo tenant để tránh noisy neighbour.
- Encryption key theo tenant nếu khách yêu cầu.
EN: "Isolation is both a data-model decision and a defense-in-depth practice at every query."` },
{ id: 'O49', topic: 'security', level: 3, q: 'How would you secure service-to-service communication? — Bảo mật giao tiếp giữa các service thế nào?', a: `
- **mTLS**: hai bên trình chứng chỉ, mã hoá và định danh; cert ngắn hạn tự xoay (SPIFFE/service mesh).
- Định danh workload thay vì secret tĩnh: IAM role, service account token ngắn hạn; secret bắt buộc thì để trong vault, không bake vào image/env commit.
- **Least privilege**: mỗi service một identity, policy chỉ cho API cần; network policy giới hạn ai gọi ai.
- Audit log có identity gọi; rate limit nội bộ chống service lỗi tự DDoS.
- Lambda/worker: không fallback localhost khi thiếu config, fail-fast.
EN: "Identity for every workload, short-lived credentials, and least privilege everywhere."` },
{ id: 'O50', topic: 'security', level: 3, q: 'An API key has leaked. Walk me through the response and how you prevent it next time. — API key bị lộ, xử lý và phòng ngừa thế nào?', a: `
- **Ngay lập tức**: thu hồi/xoay key, cấp key mới cho client hợp lệ, rate limit hoặc chặn IP lạ.
- **Điều tra**: log truy cập bằng key đó (thời gian, IP, hành vi), phạm vi dữ liệu bị ảnh hưởng, báo cáo theo quy định.
- **Nguyên nhân**: commit vào git, log in ra, env trong image, chia sẻ qua chat.
- **Phòng**: secret scanning trong CI và trên repo, key ngắn hạn tự xoay, scope hẹp theo key, vault + inject lúc chạy, hash key trong DB chỉ lưu prefix để nhận diện, alert khi key dùng từ vị trí bất thường.
- Diễn tập: quy trình xoay key phải chạy được trong vài phút, không gây downtime.
EN: "Revoke first, investigate second, then fix the process that let the key leak."` },
{ id: 'O51', topic: 'observability', level: 1, q: 'Explain logs, metrics and traces, and when you use each. — Giải thích log, metric, trace và khi nào dùng.', a: `
- **Metrics**: số tổng hợp theo thời gian (counter, gauge, histogram) → rẻ, alert, dashboard, SLO; không biết request nào.
- **Logs**: sự kiện rời rạc có ngữ cảnh → debug chi tiết; đắt ở quy mô, cần structured + sampling.
- **Traces**: đường đi một request qua nhiều service với span thời gian → tìm chỗ chậm; cần lan truyền trace id.
- Luồng: metric báo có vấn đề → trace chỉ ở đâu → log nói vì sao. Gắn trace_id vào log để nối ba thứ.
EN: "Metrics tell me something is wrong, traces tell me where, and logs tell me why."` },
{ id: 'O52', topic: 'observability', level: 1, q: 'What is the difference between p50, p99 and average latency, and why care about p99? — p50, p99 và trung bình khác gì; vì sao quan tâm p99?', a: `
- **Trung bình** bị kéo bởi ngoại lệ và che giấu đuôi; **p50** là trải nghiệm điển hình; **p99** là 1% request chậm nhất.
- Một trang gọi 20 API thì xác suất gặp ít nhất một request p99 ≈ 18% → người dùng cảm nhận đuôi, không phải trung bình.
- Người dùng nặng (nhiều dữ liệu) thường rơi vào đuôi và là khách quan trọng nhất.
- Đo bằng histogram, SLO đặt theo percentile (p99 < 500 ms), tránh trung bình của percentile giữa các node.
EN: "Averages hide the tail, and the tail is what users notice."` },
{ id: 'O53', topic: 'observability', level: 2, q: 'How would you detect a cron job or publisher that silently stopped working? — Phát hiện cron job/publisher chết im lặng thế nào?', a: `
- Lỗi im lặng không tạo 5xx hay CPU → cần tín hiệu về việc **không xảy ra**.
- **Heartbeat/dead-man switch**: job ghi last_success_at; alert khi tuổi vượt 2× chu kỳ.
- Metric nghiệp vụ: messages_published_total, rows_processed_total có rate = 0 trong N phút → alert; queue depth tăng mà consume = 0.
- Health check của connection broker/Redis trong readiness probe; reconnect có log mức error, không nuốt lỗi.
- Đối chiếu end-to-end: thời gian từ scheduled tới hoàn thành (SLO cho job).
EN: "For silent failures I alert on the absence of success, not on the presence of errors."` },
{ id: 'O54', topic: 'observability', level: 2, q: 'What is an SLO and an error budget? Give concrete numbers. — SLO và error budget là gì, cho số cụ thể.', a: `
- **SLI**: chỉ số đo được (tỉ lệ request thành công, p99 latency). **SLO**: mục tiêu cho SLI trong khoảng thời gian (99,9% thành công/30 ngày). **SLA**: hợp đồng có phạt, lỏng hơn SLO.
- **Error budget** = 1 − SLO: 99,9%/30 ngày = 43 phút downtime; 99,99% = 4,3 phút; 99% = 7,2 giờ.
- Dùng budget để quyết định: còn budget → deploy nhanh; cháy budget → đóng băng tính năng, tập trung độ tin cậy.
- Alert theo **burn rate** (tốc độ tiêu budget) thay vì ngưỡng tĩnh.
EN: "An SLO turns reliability into a budget the team can spend or protect."` },
{ id: 'O55', topic: 'observability', level: 3, q: 'How would you trace a request through API, queue, worker and Lambda? — Trace một request qua API, queue, worker, Lambda thế nào?', a: `
- Dùng OpenTelemetry: API tạo trace, **traceparent** đi qua HTTP header; khi publish, gắn trace context vào **message header**; consumer đọc header và tạo span con (hoặc span link nếu xử lý batch).
- Lambda: inject context vào payload/attribute, khởi tạo tracer ở init, flush trước khi hàm kết thúc.
- Gắn trace_id vào mọi log; trace_id trả về client trong header để support tra cứu.
- Sampling: head-based 1-10% cho tải cao, tail-based giữ 100% request lỗi/chậm.
- Thêm attribute nghiệp vụ (tenant_id, project_id) để lọc; cẩn thận cardinality ở metric, không ở trace.
EN: "The trace context has to ride along with the message, otherwise the trace breaks at the queue."` },
{ id: 'O56', topic: 'go', level: 1, q: 'Explain goroutines versus OS threads. — Goroutine khác OS thread thế nào?', a: `
- Goroutine: stack khởi đầu ~2-8 KB co giãn, tạo mất ~µs; runtime lập lịch **M:N** (G goroutine, M thread, P processor = GOMAXPROCS).
- OS thread: stack 1-8 MB, tạo và context switch do kernel, đắt hơn nhiều.
- Khi goroutine block syscall, runtime chuyển P sang thread khác; netpoller làm IO mạng không chiếm thread.
- Hệ quả: hàng trăm nghìn goroutine là bình thường, nhưng goroutine leak cũng dễ xảy ra âm thầm.
EN: "Goroutines are cheap user-space threads multiplexed by the Go runtime onto a few OS threads."` },
{ id: 'O57', topic: 'go', level: 2, q: 'How does context.Context help with cancellation and timeouts? — context.Context giúp cancel và timeout thế nào?', a: `
- Context là cây: [[context.WithTimeout/WithCancel]] tạo con; cancel cha → mọi con nhận tín hiệu qua [[ctx.Done()]].
- Truyền ctx làm tham số đầu vào mọi hàm IO (DB, HTTP, queue); thư viện chuẩn và driver tôn trọng ctx để huỷ query/kết nối.
- Request HTTP bị client huỷ → [[r.Context()]] cancel → dừng công việc phía dưới, tránh lãng phí và goroutine leak.
- Sai lầm: lưu ctx trong struct, dùng [[context.Background()]] trong handler, quên [[defer cancel()]] gây leak timer.
- Value trong ctx chỉ cho dữ liệu request-scoped (trace id, user), không cho dependency.
EN: "Context propagates deadlines and cancellation down the call tree so no work outlives its request."` },
{ id: 'O58', topic: 'go', level: 2, q: 'How would you find and fix a goroutine leak? — Tìm và sửa goroutine leak thế nào?', a: `
- Dấu hiệu: [[runtime.NumGoroutine()]] hoặc metric go_goroutines tăng đều theo thời gian dù tải ổn định; RAM tăng chậm.
- Chẩn đoán: [[/debug/pprof/goroutine?debug=2]] → nhóm stack giống nhau kẹt ở chan send/recv, select, Lock, hoặc Transport chờ đọc body.
- Nguyên nhân thường: gửi vào channel không ai nhận (worker thoát sớm), thiếu case [[<-ctx.Done()]], không đóng [[resp.Body]], time.After trong vòng lặp, WaitGroup lệch.
- Sửa: mọi goroutine phải có đường thoát rõ (ctx hoặc close channel), buffer đúng kích thước, dùng errgroup; test với [[goleak]].
EN: "A goroutine leak shows up as a steadily rising goroutine count, and pprof tells me where they are stuck."` },
{ id: 'O59', topic: 'go', level: 3, q: 'Explain Go GC tuning with GOGC and GOMEMLIMIT. When does it matter? — Tinh chỉnh GC với GOGC và GOMEMLIMIT, khi nào cần?', a: `
- GC đánh dấu-quét đồng thời, pause rất ngắn; chi phí là CPU cho mark và RAM thừa giữa hai chu kỳ.
- **GOGC** (mặc định 100): GC chạy khi heap đạt live heap × (1 + GOGC/100) → heap gấp đôi live. Tăng GOGC = ít GC hơn, tốn RAM; giảm = ngược lại.
- **GOMEMLIMIT** (Go 1.19+): trần mềm tổng bộ nhớ; gần trần GC chạy mạnh hơn → tránh OOM trong container; đặt ~80-90% memory limit, kết hợp GOGC cao hoặc off.
- Quan trọng khi: worker nạp dữ liệu lớn, container có limit chặt, latency nhạy với GC CPU.
- Đo bằng GODEBUG=gctrace=1, runtime/metrics; đừng chỉnh mù.
EN: "GOGC trades memory for GC CPU, and GOMEMLIMIT gives the runtime a hard ceiling to respect."` },
{ id: 'O60', topic: 'go', level: 3, q: 'What happens if GOMAXPROCS does not match the container CPU limit? — GOMAXPROCS lệch với CPU limit của container thì sao?', a: `
- Runtime (bản cũ) đặt GOMAXPROCS = số core host (ví dụ 64) trong khi cgroup quota chỉ 2 CPU.
- Hệ quả: nhiều thread cùng chạy, hết quota trong vài ms đầu mỗi chu kỳ CFS (100 ms) → **throttled** phần còn lại; latency răng cưa, GC worker tranh CPU, p99 tệ.
- Kiểm tra: cpu.stat nr_throttled/throttled_time trong container.
- Sửa: GOMAXPROCS theo quota (uber-go/automaxprocs hoặc env), Go mới có cgroup-aware; cân nhắc đặt CPU request = limit.
- Tương tự với GOMEMLIMIT theo memory limit.
EN: "If the runtime thinks it has 64 cores but the cgroup gives it 2, you get CFS throttling and jittery latency."` },
{ id: 'O61', topic: 'concurrency', level: 1, q: 'What is a race condition, and how do you detect one in Go? — Race condition là gì, phát hiện trong Go thế nào?', a: `
- Hai goroutine truy cập cùng dữ liệu, ít nhất một ghi, không có đồng bộ → kết quả phụ thuộc thứ tự lập lịch (lost update, đọc nửa vời, map crash).
- Phát hiện: [[go test -race]] và chạy binary build với -race ở staging; detector báo stack của hai truy cập xung đột.
- Sửa: Mutex/RWMutex bao quanh trạng thái, [[sync/atomic]] cho counter, channel để chuyển quyền sở hữu dữ liệu, hoặc thiết kế bất biến (immutable).
- Race ở tầng hệ thống (check-then-act trên DB/Redis) không có detector → cần khoá hoặc thao tác atomic ở store.
EN: "A data race is unsynchronized concurrent access with at least one write, and the race detector finds most of them."` },
{ id: 'O62', topic: 'concurrency', level: 1, q: 'When would you use a mutex versus a channel in Go? — Khi nào dùng mutex, khi nào dùng channel?', a: `
- **Mutex**: bảo vệ trạng thái chia sẻ (map, counter, cache) với critical section ngắn; đơn giản, nhanh.
- **Channel**: truyền quyền sở hữu dữ liệu giữa goroutine, pipeline, fan-in/fan-out, tín hiệu dừng; kết hợp select với ctx.
- Quy tắc: chia sẻ bộ nhớ bằng cách giao tiếp khi có luồng dữ liệu; khoá khi chỉ cần bảo vệ một biến.
- Sai lầm: dùng channel làm mutex (phức tạp, dễ deadlock), giữ mutex khi gọi IO, RWMutex cho ghi nhiều.
EN: "Use a mutex to guard state and a channel to move data or signal between goroutines."` },
{ id: 'O63', topic: 'concurrency', level: 2, q: 'How would you build a bounded worker pool, and why is unbounded fan-out dangerous? — Xây worker pool có giới hạn thế nào; vì sao fan-out không giới hạn nguy hiểm?', a: `
- Fan-out 1 goroutine/phần tử trên 1 triệu phần tử: tràn fd, RAM buffer, kết nối DB, rate limit của API ngoài, OOM.
- **Semaphore** bằng buffered channel kích thước N, hoặc [[errgroup.SetLimit(N)]]: g.Go block khi đủ N việc đang chạy.
- Pipeline: channel job → N worker đọc → channel kết quả; đóng channel job khi hết, WaitGroup chờ worker.
- Chọn N theo tài nguyên nghẽn: IO-bound N = vài chục đến trăm; CPU-bound N ≈ GOMAXPROCS.
- Mọi worker tôn trọng ctx để dừng sớm khi lỗi; thu lỗi qua errgroup.
EN: "Concurrency has to be bounded by the scarcest resource, not by how cheap goroutines are."` },
{ id: 'O64', topic: 'concurrency', level: 2, q: 'Explain optimistic versus pessimistic locking. When would you use each? — Khoá lạc quan và bi quan khác gì, dùng khi nào?', a: `
- **Pessimistic**: khoá trước khi đọc-sửa ([[SELECT ... FOR UPDATE]]); chắc chắn, đơn giản; trả giá chờ khoá, deadlock, không hợp giữ khoá qua request người dùng.
- **Optimistic**: đọc kèm version, ghi với [[WHERE version = ?]]; 0 dòng ảnh hưởng → conflict, retry; không chờ, hợp tranh chấp thấp và luồng dài (form sửa).
- Chọn: tranh chấp cao, thao tác ngắn → pessimistic; tranh chấp thấp, latency quan trọng → optimistic.
- Booking ghế: FOR UPDATE + giữ chỗ TTL, hoặc version + unique constraint làm lưới cuối.
- Phân tán: optimistic qua ETag/If-Match cho REST.
EN: "Pessimistic locking prevents conflicts; optimistic locking detects them and retries."` },
{ id: 'O65', topic: 'concurrency', level: 3, q: 'What happens if a distributed lock expires while the holder is still working? — Lock phân tán hết hạn khi người giữ còn chạy thì sao?', a: `
- Lock Redis SETNX + TTL hết hạn (GC pause, job chậm) → client khác lấy lock → **hai writer cùng lúc**; client cũ không biết mình đã mất lock.
- TTL chỉ chống lock mồ côi, không đảm bảo mutual exclusion tuyệt đối.
- Giảm thiểu: **fencing token** tăng dần kèm mỗi lần cấp lock, tài nguyên đích từ chối token nhỏ hơn token đã thấy; gia hạn lock (watchdog) khi còn chạy; release chỉ khi value khớp (Lua).
- Nếu cần an toàn thật: lock trên hệ consensus (etcd/ZooKeeper lease) hoặc dựa vào DB transaction/unique constraint thay vì lock.
- Thiết kế job idempotent để trùng là vô hại.
EN: "A lease can expire under you, so the downstream resource must be able to reject stale holders via fencing tokens."` },
{ id: 'O66', topic: 'cloud', level: 1, q: 'When would you use serverless functions, and when would you NOT? — Khi nào dùng serverless, khi nào không?', a: `
- **Dùng**: tải bùng nổ không đều, tác vụ ngắn event-driven (xử lý file upload, webhook, cron nhẹ), team nhỏ không muốn quản server, trả tiền theo lần chạy.
- **Không**: job dài quá giới hạn thời gian, kết nối bền (WebSocket, pool DB lớn → cần proxy/pooler), latency nhạy với cold start, tải đều cao (EC2/container rẻ hơn), cần debug/local dễ.
- Rủi ro vận hành: config qua console dễ trôi (mất env), giới hạn concurrency, chi phí khó đoán khi retry storm.
- SBOM: enrichment batch hợp Lambda nhưng phải có checkpoint, lease, IaC cho env.
EN: "Serverless is great for spiky, short, event-driven work and painful for long-running or connection-heavy workloads."` },
{ id: 'O67', topic: 'cloud', level: 2, q: 'Explain multi-AZ versus multi-region, with RPO and RTO. — Multi-AZ và multi-region khác gì, nói về RPO/RTO.', a: `
- **RPO**: mất tối đa bao nhiêu dữ liệu (thời gian); **RTO**: bao lâu khôi phục xong.
- **Multi-AZ**: các datacenter cùng region, độ trễ ~1-2 ms → replication đồng bộ được (RPO ≈ 0), failover tự động vài chục giây đến vài phút (RTO thấp); chống hỏng một AZ, không chống sự cố toàn region.
- **Multi-region**: độ trễ 50-150 ms → thường async (RPO vài giây đến phút); active-passive (RTO phút đến giờ, cần diễn tập) hoặc active-active (phức tạp: conflict, định tuyến).
- Chi phí multi-region gấp nhiều lần; chỉ khi yêu cầu pháp lý hoặc SLA rất cao.
- Backup khác DR: backup chống xoá nhầm, DR chống mất hạ tầng.
EN: "Multi-AZ gives near-zero RPO cheaply; multi-region is for surviving a whole-region outage at a much higher cost."` },
{ id: 'O68', topic: 'cloud', level: 2, q: 'What happens when an image tag like :latest changes underneath you, and how do you deploy safely? — Tag :latest đổi ngầm gây gì, deploy an toàn thế nào?', a: `
- Auto-pull :latest (Watchtower) kéo phiên bản không ai duyệt: major version DB, yêu cầu kernel mới → crash lúc 3 giờ sáng, không rollback được vì không biết trước đó là bản nào.
- **Pin version/digest**, nâng cấp là một commit có review; image bất biến, cùng artifact đi qua staging → prod.
- Deploy có kiểm soát: health/readiness check, rolling hoặc blue-green, canary với metric, rollback một lệnh.
- Config ngoài image (env/secret manager) nhưng bake đúng cái cần bake (NEXT_PUBLIC_* của FE build time).
- Theo dõi sau deploy 15-30 phút: error rate, latency, log mới.
EN: "Every deploy should be a reviewed change to a pinned version, never a surprise from a moving tag."` },
{ id: 'O69', topic: 'cloud', level: 3, q: 'How would you run scheduled jobs reliably across multiple instances? — Chạy job theo lịch tin cậy trên nhiều instance thế nào?', a: `
- Vấn đề với scheduler in-memory trong mỗi instance: chạy trùng khi N replica, lỡ tick khi restart/deploy, không có lịch sử.
- **Persist lịch**: bảng jobs(next_run_at, last_run_at, status); instance nào cũng poll, nhưng claim bằng [[UPDATE ... WHERE next_run_at <= now() AND status = idle]] (hoặc SELECT FOR UPDATE SKIP LOCKED) → chỉ một người thắng.
- Hoặc leader election (lease trong etcd/Redis/Postgres advisory lock) và chỉ leader lập lịch; job thực thi đẩy vào queue cho worker.
- **Catch-up policy**: lỡ tick thì chạy bù một lần hay bỏ qua; job idempotent.
- Quan sát: last_success_at + alert freshness; log mỗi lần chạy với job id.
EN: "Scheduling state belongs in a database with a claim step so exactly one instance fires each run."` },
{ id: 'O70', topic: 'cloud', level: 3, q: 'How would you design autoscaling for a queue consumer? — Thiết kế autoscaling cho consumer của queue thế nào?', a: `
- Metric đúng: **backlog** (queue depth) và **tuổi message cũ nhất**, chia cho throughput mỗi consumer → số consumer cần; CPU không phản ánh IO-bound.
- Mục tiêu dạng SLO: message phải được xử lý trong X phút → scale để backlog / (rate × N) < X.
- Scale-out nhanh, scale-in chậm (cooldown) để tránh dao động; min replica > 0 để tránh cold start; max để bảo vệ DB phía sau.
- Downstream là giới hạn thật: nhiều consumer hơn có thể chỉ chuyển nghẽn sang DB/API ngoài → rate limit, backpressure.
- Graceful shutdown: ngừng nhận, xử lý nốt, ack, rồi thoát; prefetch nhỏ để message không mắc kẹt khi scale-in.
EN: "I would scale on backlog and message age, with asymmetric cooldowns and a ceiling that protects the database."` },
{ id: 'O71', topic: 'design', level: 1, q: 'How do you start a system design interview? What do you clarify first? — Bắt đầu buổi phỏng vấn system design thế nào, làm rõ gì trước?', a: `
- Nhắc lại đề bằng lời mình, hỏi **functional** cốt lõi (3-5 use case, cái gì ngoài phạm vi).
- **Non-functional**: quy mô (DAU, QPS, dữ liệu), tỉ lệ đọc/ghi, latency mục tiêu, availability, consistency cần mạnh ở đâu, vùng địa lý.
- Ước lượng nhanh để chọn kiến trúc (một DB đủ hay cần shard?).
- Chốt ưu tiên với người phỏng vấn rồi vẽ high-level, sau đó hỏi họ muốn đào sâu điểm nào.
- Quản lý thời gian: 5 phút làm rõ, 5 ước lượng, 10-12 tổng thể, 15-18 đào sâu, 5 tổng kết.
EN: "Before drawing anything, let me clarify the core use cases and the scale we are designing for."` },
{ id: 'O72', topic: 'design', level: 1, q: 'Quick estimate: 10 million DAU, 20 requests per user per day, peak 3x. What are the QPS and yearly storage at 1 KB per request? — Ước lượng nhanh QPS và dung lượng một năm.', a: `
- Request/ngày = 10^7 × 20 = 2 × 10^8; 1 ngày ≈ 10^5 s → **~2 000 QPS** trung bình, **~6 000 QPS** đỉnh.
- Dữ liệu/ngày = 2 × 10^8 × 1 KB = 200 GB; một năm ≈ 365 × 200 GB ≈ **73 TB** (chưa tính replica, index; nhân 2-3).
- Kết luận thiết kế: vài app server đủ cho 6k QPS; 73 TB/năm vượt một Postgres thoải mái → partition theo thời gian, lưu lạnh dữ liệu cũ, object storage cho blob.
- Luôn làm tròn số đẹp và nói rõ giả định.
EN: "Roughly two thousand QPS on average, six thousand at peak, and about seventy terabytes a year before replication."` },
{ id: 'O73', topic: 'design', level: 2, q: 'How would you generate unique IDs in a distributed system? — Sinh ID duy nhất trong hệ phân tán thế nào?', a: `
- **UUIDv4**: không phối hợp, 128-bit, nhưng ngẫu nhiên → index B-tree phân mảnh, không sort theo thời gian.
- **Snowflake** 64-bit: timestamp (41 bit) + machine id (10) + sequence (12) → sortable, nhỏ; cần cấp machine id và chịu clock đi lùi (chờ hoặc từ chối).
- **UUIDv7/ULID**: thời gian ở đầu + random, không cần phối hợp, sortable; lựa chọn mặc định hiện nay.
- **DB sequence/ticket server**: đơn giản nhưng SPOF và nghẽn; cấp dải (range) cho từng node giảm gọi.
- Yêu cầu dẫn dắt: cần sort theo thời gian? lộ số lượng (ID tăng đoán được) có sao không? kích thước key?
EN: "If I need time-ordered keys without coordination, UUIDv7 or a Snowflake-style ID is my default."` },
{ id: 'O74', topic: 'design', level: 2, q: 'How do you decide between a monolith and microservices? — Quyết định monolith hay microservices thế nào?', a: `
- Microservices giải quyết vấn đề **tổ chức** (nhiều team deploy độc lập) và scale từng phần khác nhau; trả giá bằng network, consistency phân tán (saga, outbox), observability, vận hành.
- Monolith (modular) nhanh để phát triển, transaction đơn giản, debug dễ; vẫn scale ngang được nếu stateless.
- Tách khi: team > 2 pizza, module có nhịp release/scale rất khác (worker enrichment vs API), ranh giới domain rõ.
- Tách sai → distributed monolith: mọi service deploy cùng lúc, gọi đồng bộ dây chuyền.
- Bắt đầu modular monolith, tách theo đường nối đã chứng minh (queue có sẵn).
EN: "I start with a modular monolith and extract services only where team or scaling boundaries demand it."` },
{ id: 'O75', topic: 'design', level: 3, q: 'How would you design for multi-tenancy and prevent noisy neighbours? — Thiết kế multi-tenant và chống noisy neighbour thế nào?', a: `
- Mô hình dữ liệu theo bậc: shared (tenant_id + RLS) cho tenant nhỏ, DB/cluster riêng cho enterprise; routing theo tenant ở gateway.
- **Giới hạn theo tenant**: rate limit API, quota job, queue/partition riêng hoặc fair scheduling (round-robin giữa tenant), connection pool/timeout theo tenant.
- Cách ly tải nặng: tenant có 200k component không được chiếm worker chung → tách queue ưu tiên, giới hạn batch size.
- Dữ liệu chung (CVE, license) tách khỏi dữ liệu tenant, overlay per-tenant; metric và chi phí theo tenant để phát hiện kẻ ồn.
- Migration schema × N tenant cần tự động hoá và có thứ tự.
EN: "Multi-tenancy is about both data isolation and resource fairness, enforced per tenant at every shared layer."` },
{ id: 'O76', topic: 'data', level: 1, q: 'Explain batch versus stream processing. — Xử lý theo lô và theo dòng khác gì?', a: `
- **Batch**: xử lý tập dữ liệu hữu hạn theo lịch (giờ/ngày); throughput cao, đơn giản, kết quả chính xác và dễ chạy lại; độ trễ bằng chu kỳ.
- **Stream**: xử lý từng event khi đến; độ trễ giây; phải xử lý event trễ, trùng, trạng thái (window), khó chạy lại.
- Chọn: báo cáo cuối ngày, reindex, đối soát → batch; alert, dashboard realtime, enrichment ngay khi upload → stream/queue.
- Nhiều hệ dùng cả hai: stream cho số gần đúng nhanh, batch chốt số đúng.
EN: "Batch is correct and late; streaming is fast and approximate, so many systems run both."` },
{ id: 'O77', topic: 'data', level: 2, q: 'How would you handle late-arriving events when aggregating per-minute counts? — Xử lý event đến trễ khi tổng hợp theo phút thế nào?', a: `
- Phân biệt **event time** (lúc xảy ra) và **processing time** (lúc nhận); tổng hợp phải theo event time.
- **Watermark**: ước lượng mọi event trước thời điểm T đã đến; đóng window khi watermark vượt T + allowed lateness (ví dụ 5 phút).
- Event tới sau đó: bỏ, hoặc cập nhật lại kết quả (upsert theo (window, key)) và phát bản sửa.
- Lưu kết quả idempotent theo (window, key) để replay an toàn; batch cuối ngày đối soát số cuối cùng.
- Trade-off: lateness lớn → kết quả muộn và state lớn; nhỏ → mất event.
EN: "I aggregate on event time with a watermark and allowed lateness, then reconcile with a batch job."` },
{ id: 'O78', topic: 'data', level: 2, q: 'What happens if one bad item fails a batch job? How do you design for partial failure? — Một phần tử lỗi làm hỏng cả lô thì sao; thiết kế cho partial failure?', a: `
- Nguy cơ: một coordinate lỗi làm API ngoài trả lỗi cả batch → code nuốt lỗi và đánh dấu cả 100 dòng failed vĩnh viễn (hoặc ngược lại: retry cả batch mãi).
- Nguyên tắc: **ngữ nghĩa lỗi ở cấp item**; batch chỉ là tối ưu vận chuyển.
- Khi batch fail: **bisect** chia đôi retry, hoặc fallback xử lý từng item, để cô lập phần tử hỏng; đánh dấu riêng phần tử hỏng (lý do, attempt).
- Validate đầu vào trước khi gộp batch (coordinate dạng version-range bỏ ra sớm).
- Không bao giờ nuốt lỗi im lặng: log + metric theo loại lỗi; trạng thái failed phải có đường retry/sửa tay.
EN: "A batch is a transport optimization; failure handling has to stay per item."` },
{ id: 'O79', topic: 'data', level: 3, q: 'How would you design a sweeper or retry system that does not starve new work? — Thiết kế sweeper/retry không bỏ đói việc mới thế nào?', a: `
- Bẫy: lấy N dòng pending cũ nhất → dòng lỗi lặp chiếm chỗ mãi (starvation), query ListAllPending quét toàn bảng hết budget → xử lý 0 dòng.
- Mỗi dòng có **attempts**, **next_retry_at** với exponential backoff + jitter; quá N lần → trạng thái failed/DLQ, không chọn lại.
- Query chọn việc: WHERE status = pending AND next_retry_at <= now() ORDER BY next_retry_at LIMIT N với **partial index** đúng điều kiện; claim bằng FOR UPDATE SKIP LOCKED.
- Công bằng giữa tenant: round-robin hoặc giới hạn N theo tenant; tách hàng đợi việc mới và retry.
- Dọn đầu vào không hợp lệ (không có purl) sang trạng thái riêng để không chiếm hàng đợi.
EN: "Retries need backoff, an attempt limit and a terminal state, otherwise poison rows starve everything else."` },
{ id: 'O80', topic: 'data', level: 3, q: 'Explain how you would reconcile fast streaming results with accurate batch results. — Đối soát kết quả stream nhanh với kết quả batch chính xác thế nào?', a: `
- Kiến trúc lambda: **speed layer** (stream, gần đúng, vài giây) và **batch layer** (chạy lại từ dữ liệu gốc, chính xác, hàng giờ); serving layer ưu tiên số batch khi có.
- Dữ liệu gốc phải bất biến và giữ đủ lâu (log, object storage) để batch chạy lại được.
- Khi lệch: batch ghi đè số stream theo (window, key); phát event sửa cho hệ phía sau; đo tỉ lệ lệch như một metric chất lượng.
- Kappa thay thế: chỉ stream nhưng replay được từ log (Kafka retention) → một code path, cần exactly-once-ish sink.
- Bài học reconcile: không được để lần chạy lỗi/rỗng ghi đè kết quả tốt → phân biệt rỗng với thất bại.
EN: "Streaming gives a fast estimate, the batch recomputation is the source of truth, and the serving layer overwrites with batch when it lands."` },
{ id: 'O81', topic: 'search', level: 1, q: 'Explain an inverted index. — Giải thích inverted index.', a: `
- Thay vì tài liệu → từ, lưu **từ → danh sách tài liệu** (posting list) kèm vị trí/tần suất.
- Phân tích văn bản: tokenize, lowercase, bỏ stopword, stemming; cùng pipeline cho query.
- Query nhiều từ = giao/hợp posting list; xếp hạng bằng TF-IDF/BM25.
- Cập nhật tốn kém (segment bất biến, merge nền) → near-real-time, không ACID; là index dẫn xuất từ DB.
- Postgres có tsvector/GIN cho nhu cầu vừa; Elasticsearch/OpenSearch cho lớn và phân tích đa ngôn ngữ.
EN: "An inverted index maps each term to the documents containing it, which is what makes keyword search fast."` },
{ id: 'O82', topic: 'search', level: 1, q: 'Why is LIKE %keyword% a bad idea for search, and what are the options? — Vì sao LIKE %từ khoá% tệ cho tìm kiếm, có lựa chọn nào?', a: `
- Wildcard ở đầu không dùng được B-tree → full scan mỗi query, không xếp hạng, không xử lý dấu/biến thể từ.
- **Prefix** (LIKE abc%) dùng được index; **trigram** (pg_trgm + GIN) cho chứa chuỗi và gần đúng ở quy mô vừa.
- **Full-text** Postgres (tsvector, GIN) cho tìm theo từ có stemming, xếp hạng cơ bản.
- Ngoài đó: Elasticsearch/OpenSearch, Meilisearch khi cần facet, typo tolerance, đa ngôn ngữ, quy mô lớn; đồng bộ từ DB.
- Luôn hỏi: tìm theo từ hay chứa chuỗi? cần xếp hạng? bao nhiêu dữ liệu?
EN: "Leading-wildcard LIKE cannot use an index, so I reach for trigram or full-text indexes first."` },
{ id: 'O83', topic: 'search', level: 2, q: 'How would you design autocomplete for top-k suggestions? — Thiết kế autocomplete trả top-k gợi ý thế nào?', a: `
- Yêu cầu: p99 < 50-100 ms, hàng chục nghìn QPS, chỉ cần vài ký tự đầu, kết quả không cần tươi từng giây.
- **Trie** với top-k tính sẵn ở mỗi node (hoặc map prefix → top-k), phục vụ từ RAM, shard theo ký tự đầu, replica nhiều.
- Dữ liệu tần suất từ log tìm kiếm → pipeline **batch** (giờ/ngày) rebuild và swap; lớp trending riêng nếu cần.
- Client: debounce 100-200 ms, cache kết quả theo prefix, chỉ gọi từ 2 ký tự; CDN/edge cache prefix ngắn.
- Lọc nội dung xấu, cá nhân hoá nhẹ ở lớp sau.
EN: "Precompute top-k per prefix offline and serve it from memory; autocomplete is a read-heavy, latency-bound problem."` },
{ id: 'O84', topic: 'search', level: 2, q: 'How would you keep Elasticsearch in sync with Postgres, and when would you NOT use Elasticsearch? — Đồng bộ Elasticsearch với Postgres thế nào; khi nào không nên dùng ES?', a: `
- Postgres là source of truth; ES là index dẫn xuất có thể rebuild.
- Đồng bộ: **CDC** (Debezium đọc WAL → Kafka → indexer) tin cậy nhất; hoặc outbox event; tránh dual write từ app (mất đồng bộ khi một bên lỗi).
- Indexer idempotent (upsert theo id + version), xử lý xoá, bulk API, reindex vào alias mới rồi swap alias để không downtime.
- Theo dõi lag đồng bộ; kiểm tra đếm chéo định kỳ.
- Không dùng ES khi: dữ liệu nhỏ (Postgres full-text đủ), cần transaction/consistency mạnh, team không có sức vận hành cluster, chỉ cần tra theo khoá.
EN: "Treat Elasticsearch as a rebuildable index fed by change data capture, never as the system of record."` },
{ id: 'O85', topic: 'search', level: 3, q: 'How would you implement proximity search, such as finding places within 1 km? — Cài đặt tìm kiếm lân cận (trong bán kính 1 km) thế nào?', a: `
- Hai B-tree riêng trên lat/lng giao nhau kém; cần index không gian.
- **Geohash**: mã hoá (lat, lng) thành chuỗi, prefix chung = ô lân cận; query = các ô quanh điểm (xử lý biên ô) rồi lọc chính xác bằng haversine. Dễ cài trên Redis/DB thường.
- **Quadtree/R-tree** (PostGIS GiST): ô chia theo mật độ, tốt cho phân bố lệch; S2/H3 cho toàn cầu.
- Dữ liệu động (tài xế di chuyển) → Redis GEO (sorted set geohash) cập nhật mỗi vài giây; dữ liệu tĩnh (quán ăn) → PostGIS hoặc ES geo_point.
- Scale: shard theo vùng, cache ô nóng, trả kết quả theo trang có sort theo khoảng cách.
EN: "I would turn the 2D problem into a 1D prefix search with geohash or use a spatial index like PostGIS."` },
{ id: 'O86', topic: 'realtime', level: 1, q: 'Compare polling, long polling, SSE and WebSocket. — So sánh polling, long polling, SSE và WebSocket.', a: `
- **Short polling**: client hỏi mỗi N giây; đơn giản, trễ N, nhiều request rỗng.
- **Long polling**: server giữ request đến khi có dữ liệu hoặc timeout; trễ thấp hơn, tốn kết nối treo, tương thích mọi proxy.
- **SSE**: một chiều server → client trên HTTP, tự reconnect, nhẹ; không gửi ngược (dùng POST riêng).
- **WebSocket**: hai chiều, bền, chi phí mỗi tin nhắn nhỏ; cần LB hỗ trợ upgrade, quản lý kết nối, scale ngang khó hơn.
- Chọn: thông báo/feed → SSE; chat/game/collab → WebSocket; tích hợp bên ngoài đơn giản → long polling.
EN: "If I only need server push, SSE is simpler; if I need bidirectional low-latency traffic, WebSocket."` },
{ id: 'O87', topic: 'realtime', level: 2, q: 'How would you route a chat message to a user connected to a different server? — Chuyển tin nhắn tới user đang kết nối ở server khác thế nào?', a: `
- Kết nối WebSocket là state cục bộ của một node; cần lớp định tuyến giữa các node.
- **Session registry**: user_id → node_id (Redis, TTL theo heartbeat); node gửi tra registry rồi chuyển tiếp (gRPC/queue) tới node đích.
- Hoặc **pub/sub** theo kênh (room hoặc user): mọi node subscribe kênh của user mình đang giữ; Redis pub/sub, NATS, Kafka theo quy mô.
- Lưu tin nhắn bền trước khi fan-out để offline nhận lại; ack từ client để đánh dấu đã giao.
- Sticky session chỉ giúp reconnect về cùng node, không giải quyết routing.
EN: "Connections are local to a server, so I need a registry or pub/sub layer to bridge between servers."` },
{ id: 'O88', topic: 'realtime', level: 2, q: 'How would you guarantee message ordering in a chat channel? — Đảm bảo thứ tự tin nhắn trong một kênh thế nào?', a: `
- Không dựa vào đồng hồ client hay nhiều node server (lệch).
- **Sequence theo kênh**: một điểm cấp số cho mỗi channel (DB sequence, Redis INCR theo channel, hoặc partition Kafka theo channel_id → offset); thứ tự toàn cục chỉ cần trong kênh nên scale theo kênh.
- Client hiển thị theo seq, phát hiện lỗ hổng seq → kéo lại đoạn thiếu (sync từ seq cuối đã có).
- Ghi tin nhắn (có seq) bền trước khi fan-out; consumer idempotent theo message id.
- Chấp nhận: tin nhắn gửi đồng thời sắp theo thứ tự server nhận, hiển thị giống nhau ở mọi client.
EN: "I assign a per-channel monotonically increasing sequence on the server and let clients detect gaps."` },
{ id: 'O89', topic: 'realtime', level: 3, q: 'What happens when you roll out a new version to servers holding one million WebSocket connections? — Deploy phiên bản mới lên server đang giữ 1 triệu WebSocket thì sao?', a: `
- Restart → 1 triệu client reconnect cùng lúc: LB, auth, registry, DB bị **thundering herd**; nếu auth sập, client retry càng dồn.
- Server: **graceful drain** — ngừng nhận mới, gửi close có mã yêu cầu reconnect theo lô nhỏ trong vài phút, chờ xử lý nốt rồi thoát.
- Client: **exponential backoff + jitter**, resume theo seq cuối thay vì tải lại toàn bộ, token còn hạn để không gọi auth.
- Hạ tầng: rolling theo từng phần nhỏ, LB nhận biết số connection, connection limit mỗi node, warm-up node mới.
- Diễn tập trước và đo: thời gian hồi toàn bộ kết nối, tải đỉnh trên auth.
EN: "Deploying stateful connection servers is a load event, so I drain slowly and make clients reconnect with jitter."` },
{ id: 'O90', topic: 'realtime', level: 3, q: 'How would you implement online presence at scale? — Cài đặt trạng thái online ở quy mô lớn thế nào?', a: `
- **Heartbeat** từ client mỗi 20-30 s; Redis key presence:user với TTL ~60 s; offline = key hết hạn (không cần sự kiện disconnect đáng tin).
- Fan-out hạn chế: chỉ đẩy thay đổi tới bạn bè đang online và đang mở danh sách; batch/coalesce thay đổi trong vài giây; còn lại **pull** khi mở màn hình.
- Chống flapping: trễ công bố offline 1-2 phút; gộp nhiều thiết bị của cùng user.
- Quy mô: 100 triệu user online × heartbeat 30 s ≈ 3 triệu ghi/giây → shard Redis theo user, hoặc gateway gộp heartbeat.
- Presence là dữ liệu chấp nhận trễ và mất; không ghi vào DB bền.
EN: "Presence is heartbeat plus TTL, with lazy, batched fan-out because it tolerates staleness."` }
];
