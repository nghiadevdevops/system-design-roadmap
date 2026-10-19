/* ===== Giai đoạn 2 · Khối xây dựng (tuần 10–13): B11–B20 ===== */
window.LESSONS_B2 = [
{ id: 'B11', type: 'block', topic: 'search', title: 'Tìm kiếm và đánh chỉ mục: inverted index, Elasticsearch, autocomplete, full-text trong Postgres', time: '120 phút',
  goal: 'Chọn đúng công cụ tìm kiếm cho một bài toán cụ thể (Postgres tsvector/pg_trgm hay Elasticsearch), giải thích được inverted index, relevance BM25, near real-time refresh và cách đồng bộ dữ liệu từ DB sang search index mà không mất dữ liệu.',
  md: `
### Vấn đề cần giải
- [[WHERE name LIKE '%lodash%']] trên 10 triệu dòng là full scan: B-tree chỉ dùng được cho prefix ([[LIKE 'lodash%']]). Một câu tìm "chứa từ" trên bảng lớn mất vài giây và ăn hết I/O của DB chính.
- Người dùng gõ "log4j vulnerable" muốn ra cả "Log4Shell", "log4j-core"; muốn kết quả **xếp hạng** theo độ liên quan chứ không theo id. B-tree không biết "liên quan" là gì.
- Autocomplete cần trả lời trong ~50 ms cho mỗi phím gõ, hàng chục nghìn lần/giây. Đây là bài toán khác hẳn full-text.
- Vì vậy tồn tại một cấu trúc dữ liệu riêng (inverted index) và một lớp hệ thống riêng (search engine) với trade-off riêng: **không phải source of truth**, cập nhật trễ, tốn RAM.

### Cốt lõi
#### 1. Inverted index
- Index xuôi: document -> danh sách từ. Inverted index: **term -> danh sách document (posting list)**, kèm vị trí và tần suất.
- Pipeline tạo term gọi là **analyzer** = tokenizer (tách từ) + filters (lowercase, bỏ stop word, **stemming**: "running" -> "run", synonym). Query cũng đi qua analyzer giống hệt, nếu không sẽ không khớp.
- Posting list được sort theo doc id để giao (AND) hai list bằng merge O(n+m). Đây là lý do tìm nhiều từ vẫn nhanh.
- Chi phí: index thường bằng 20–50% kích thước dữ liệu gốc (chưa tính stored fields); ghi chậm hơn B-tree vì phải cập nhật nhiều posting list.

:::diagram
Doc1[Doc 1 - log4j core] -> T_log4j[term - log4j]
Doc2[Doc 2 - log4j api] -> T_log4j
Doc1 -> T_core[term - core]
Doc2 -> T_api[term - api]
Query[Query - log4j AND core] -> T_log4j : lookup
Query -> T_core : lookup
T_log4j -> Merge[merge posting lists]
T_core -> Merge
Merge -> Rank[BM25 scoring]
Rank -> Result[top-k]
:::

#### 2. Relevance: TF-IDF và BM25
- **TF** (term frequency): từ xuất hiện nhiều trong document thì document liên quan hơn. **IDF** (inverse document frequency): từ hiếm trong toàn tập (như "log4shell") đáng giá hơn từ phổ biến ("library").
- **BM25** là TF-IDF cải tiến: TF bão hoà (xuất hiện 50 lần không hơn 10 lần bao nhiêu, tham số k1 ≈ 1.2) và chuẩn hoá theo độ dài document (tham số b ≈ 0.75). Elasticsearch và Lucene dùng BM25 mặc định từ bản 5.
- Trong phỏng vấn chỉ cần nói: score = tổng theo từng term của IDF × TF đã bão hoà; boost theo field (title nặng hơn body).

#### 3. Elasticsearch: mô hình vận hành
| Khái niệm | Ý nghĩa | Lưu ý vận hành |
|---|---|---|
| Index | Tập document cùng mapping, giống "bảng" | Mapping gần như bất biến: đổi kiểu field = reindex |
| Shard (primary) | Một Lucene index độc lập, đơn vị phân tán | Số shard cố định lúc tạo index; mục tiêu 10–50 GB mỗi shard |
| Replica | Bản sao shard, phục vụ đọc + HA | Tăng replica tăng throughput đọc, tăng chi phí ghi |
| Refresh | Làm segment mới searchable | Mặc định 1 s: **near real-time**, không phải real-time |
| Segment merge | Gộp segment nhỏ thành lớn | Ăn I/O nền; nhiều segment nhỏ làm query chậm |
| Reindex | Copy sang index mới + alias swap | Cách duy nhất đổi analyzer/mapping không downtime |

- Ghi vào ES: document được đưa vào buffer trong RAM + translog; sau **refresh interval** (1 s) mới tìm được. Bulk import nên tăng refresh_interval lên 30 s hoặc -1 rồi trả lại.
- ES **không phải source of truth**: không có transaction đa document, mapping cứng, từng mất dữ liệu khi split-brain cấu hình sai. Dữ liệu gốc nằm ở Postgres; ES là **derived data** có thể xây lại từ đầu.
- Đồng bộ DB -> ES, theo thứ tự nên dùng:
  1. **CDC** (Debezium đọc WAL) -> Kafka/RabbitMQ -> indexer. Không sửa code ứng dụng, không bỏ sót cập nhật.
  2. **Outbox**: ghi bảng outbox cùng transaction với dữ liệu, relay đẩy sang ES. Đảm bảo "ghi DB thành công thì chắc chắn có event".
  3. Dual-write từ code (ghi DB rồi ghi ES): đơn giản nhất nhưng **sai nhiều nhất** — ES ghi lỗi thì lệch vĩnh viễn, không ai biết.
- Luôn có job **full reindex** định kỳ hoặc theo yêu cầu để sửa drift. Idempotent: dùng id của DB làm _id của ES để ghi lại không tạo trùng.

#### 4. Autocomplete (typeahead)
- Yêu cầu khác full-text: prefix match, độ trễ p99 < 100 ms, kết quả top-k theo độ phổ biến, không cần relevance phức tạp.
- **Trie** (prefix tree): mỗi node lưu sẵn top-k gợi ý của nhánh đó -> trả lời O(độ dài prefix). Trie 10 triệu cụm từ chiếm vài GB RAM; shard theo chữ cái đầu hoặc hash prefix.
- Dữ liệu "phổ biến" (số lần được tìm) cập nhật **offline** theo giờ/ngày từ log; không cập nhật trie theo từng lượt gõ vì ghi tranh chấp với đọc và dễ bị spam làm lệch.
- Phương án thực dụng khi dữ liệu nhỏ (< vài triệu): ES completion suggester / edge n-gram, Redis sorted set với key là prefix, hoặc Postgres [[text_pattern_ops]] index cho [[LIKE 'abc%']].
- Debounce ở client (150–300 ms) và chỉ gửi từ 2–3 ký tự giảm 5–10 lần số request.

#### 5. Full-text ngay trong Postgres
- [[tsvector]] + [[tsquery]] + index **GIN**: cột generated [[to_tsvector('english', name || ' ' || description)]], query [[@@ to_tsquery('log4j & core')]]. Có stemming, ranking bằng [[ts_rank]]; không có BM25 chuẩn nhưng đủ cho đa số admin UI.
- [[pg_trgm]] (trigram) + GIN/GiST: hỗ trợ [[LIKE '%lodash%']], [[ILIKE]] và similarity cho gõ sai chính tả. Hợp với dữ liệu ≤ vài triệu dòng; index trigram lớn gấp 2–3 lần cột gốc.
- Ưu điểm lớn nhất: **một nguồn chân lý, có transaction, không có pipeline đồng bộ**. Chọn Postgres trước; chỉ sang ES khi (a) > 10–50 triệu document, (b) cần relevance/facet/aggregation phức tạp, (c) search chiếm quá nhiều CPU của DB chính.

#### 6. Tìm kiếm trong multi-tenant
- Mọi query **bắt buộc** có filter tenant_id (filter context trong ES không tính điểm, được cache bitset nên rẻ). Tenant nhỏ dùng chung index; tenant rất lớn tách index riêng (khi > vài trăm GB hoặc cần SLA riêng).
- **Routing** theo tenant_id: document của một tenant nằm trong một shard -> query chỉ chạm 1 shard thay vì tất cả. Giá: shard nóng nếu một tenant quá lớn (noisy neighbor).
- Postgres: cột tenant_id đứng đầu index tổng hợp; row-level security ở bài B15/B19.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Refresh interval mặc định ES | 1 s (near real-time) |
| Kích thước shard khuyến nghị | 10–50 GB, tránh > 1000 shard mỗi node |
| Heap JVM cho ES | ≤ 50% RAM và ≤ 32 GB (compressed oops) |
| Độ trễ autocomplete | p99 < 100 ms, debounce client 150–300 ms |
| Kích thước index | inverted ~20–50% dữ liệu gốc; trigram 2–3× cột gốc |
| BM25 tham số | k1 ≈ 1.2, b ≈ 0.75 |

### Sai lầm hay gặp
- Dùng ES làm nơi lưu duy nhất rồi phát hiện không rebuild được khi mapping sai hoặc cluster hỏng.
- Dual-write không có retry/reconcile -> dữ liệu lệch im lặng; không có job so khớp số document giữa DB và ES nên không ai biết.
- Analyzer lúc query khác lúc index (index bằng standard, query bằng keyword) -> "tìm không ra" dù dữ liệu có.
- Tạo quá nhiều shard nhỏ (mỗi tenant 5 shard × 1000 tenant) -> cluster quá tải metadata, heap đầy.
- Dùng [[LIKE '%x%']] trên bảng lớn và nghĩ "thêm index là xong" — B-tree không giúp; cần pg_trgm hoặc tsvector.
- Thiết kế autocomplete cập nhật trie online theo từng lần gõ, vừa chậm vừa bị spam.
- Quên filter tenant_id ở một endpoint search -> leak dữ liệu cross-tenant; đây là lỗi bảo mật chứ không chỉ là bug.

### Nói thế nào trong phỏng vấn (EN)
- "I would keep Postgres as the source of truth and treat the search index as derived data that can be rebuilt." — Postgres là chân lý, index tìm kiếm là dữ liệu dẫn xuất có thể xây lại.
- "Elasticsearch is near real-time: by default a document becomes searchable about one second after indexing." — ES là near real-time, mặc định 1 giây.
- "To keep the index in sync I would use CDC or an outbox table rather than dual writes, which drift silently." — Đồng bộ bằng CDC/outbox thay vì dual-write vì dual-write lệch âm thầm.
- "For autocomplete the requirement is prefix lookup under 100 ms, so a trie with precomputed top-k per node fits better than full-text search." — Autocomplete cần prefix dưới 100 ms, trie với top-k tính sẵn hợp hơn.
- "For a few million rows I would start with Postgres tsvector and a GIN index; it avoids a whole sync pipeline." — Vài triệu dòng thì tsvector + GIN trước, khỏi cần pipeline đồng bộ.
- "Every search query must carry the tenant filter; in Elasticsearch I would put it in the filter context and route by tenant id." — Mọi query phải có tenant filter, để ở filter context và routing theo tenant.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Hệ thống đang có Elasticsearch nhưng hãy liệt kê thật: màn hình nào search qua ES, màn nào qua Postgres ILIKE? Đo p95 của endpoint tìm component theo tên trên tenant lớn nhất (45k component). Nếu ILIKE trên t_components đang > 500 ms thì thử GIN pg_trgm hoặc cột tsvector generated trước khi nghĩ tới ES.
- Kiểm tra cách dữ liệu vào ES hiện tại: dual-write từ apiserver hay có outbox/CDC? Viết script đếm số document theo tenant ở ES so với COUNT ở Postgres; chênh lệch > 0 là bằng chứng drift để đề xuất job reindex định kỳ.
- Vulnerability DB dùng chung (OSV/NVD/GHSA, hàng trăm nghìn tới triệu bản ghi, alias nhiều) là ứng viên tốt cho full-text: tìm theo CVE id, alias, tên package, mô tả. Đây là dữ liệu chung không có tenant_id, nên tách index riêng với index component per-tenant.
- Autocomplete tên package khi tạo policy: dữ liệu nhỏ (vài trăm nghìn tên purl) -> Redis sorted set theo prefix hoặc ES completion suggester; không cần tự viết trie.
- Multi-tenant: viết checklist "mọi query search có tenant_id" và thêm test tích hợp tạo 2 tenant, tìm từ tenant A phải không thấy component của tenant B — bài học leak license cross-tenant (sự cố #15) áp sang search.
- Nếu project stress test 200k component (sự cố #16) được index vào ES với routing theo tenant_id, shard đó sẽ nóng; cân nhắc không index tenant nội bộ hoặc tách index riêng.
- Analyzer cho tên package: purl như [[pkg:npm/@babel/core@7.0.0]] bị standard analyzer cắt thành token vô nghĩa; cần analyzer riêng (tách theo [[/]], [[@]], [[-]], [[.]]) và field keyword song song để lọc chính xác. Kiểm tra mapping hiện tại trước khi đổ lỗi cho "search không ra".
- Việc tuần này: (1) đo p95 search component trên tenant lớn, (2) thử pg_trgm trên bản sao DB local và so sánh, (3) viết ADR ngắn "Postgres full-text vs ES cho component search" có số liệu đo được.
`,
  quiz: [
    { t: 'mc', q: 'Inverted index khác B-tree ở điểm cốt lõi nào?', o: ['Inverted index chỉ lưu được số nguyên', 'Inverted index ánh xạ term -> danh sách document chứa term đó, còn B-tree ánh xạ giá trị khoá -> vị trí dòng', 'B-tree nhanh hơn inverted index cho mọi loại query', 'Inverted index không hỗ trợ tìm nhiều từ cùng lúc'], a: 1, why: 'Inverted index đảo chiều: từ term tìm ra document; tìm nhiều từ là giao các posting list.' },
    { t: 'mc', q: 'Vì sao Elasticsearch được gọi là near real-time chứ không phải real-time?', o: ['Vì mạng giữa client và ES luôn có độ trễ', 'Vì ES phải chờ replica xác nhận mới trả lời', 'Vì document chỉ searchable sau refresh interval (mặc định 1 s) khi segment mới được mở', 'Vì BM25 cần tính lại IDF toàn cục sau mỗi lần ghi'], a: 2, why: 'Ghi vào buffer + translog, sau refresh (1 s) segment mới trở thành searchable.' },
    { t: 'mc', q: 'Cách đồng bộ Postgres -> Elasticsearch nào dễ gây lệch dữ liệu âm thầm nhất?', o: ['Dual-write từ code ứng dụng: ghi DB xong ghi ES, không retry', 'CDC đọc WAL bằng Debezium', 'Outbox table ghi cùng transaction', 'Full reindex theo lịch hằng đêm'], a: 0, why: 'Dual-write khi ghi ES lỗi thì DB đã commit, không có cơ chế bù; CDC/outbox đảm bảo event tồn tại khi dữ liệu tồn tại.' },
    { t: 'mc', q: 'Bảng components có 2 triệu dòng, cần tìm "chứa chuỗi" không phân biệt hoa thường và chịu gõ sai chính tả nhẹ. Lựa chọn hợp lý nhất?', o: ['B-tree index trên cột name', 'Thêm cluster Elasticsearch 3 node', 'Tăng work_mem để LIKE chạy nhanh hơn', 'pg_trgm với GIN index trên cột name'], a: 3, why: 'Dữ liệu nhỏ, cần ILIKE và similarity: pg_trgm giải quyết ngay trong Postgres, không cần pipeline đồng bộ.' },
    { t: 'mc', q: 'Trong ES multi-tenant, routing theo tenant_id mang lại gì và trả giá gì?', o: ['Tăng relevance; trả giá bằng bộ nhớ heap', 'Query chỉ chạm 1 shard thay vì tất cả; trả giá bằng nguy cơ shard nóng khi một tenant quá lớn', 'Giảm số replica cần có; trả giá bằng độ trễ refresh', 'Cho phép đổi mapping không reindex; trả giá bằng kích thước index'], a: 1, why: 'Routing gom document một tenant vào một shard, giảm fan-out; tenant khổng lồ sẽ làm shard đó mất cân bằng.' },
    { t: 'fill', q: 'Điền: hàm xếp hạng mặc định của Lucene/Elasticsearch, cải tiến TF-IDF với TF bão hoà và chuẩn hoá độ dài, gọi là ___.', a: ['bm25', 'okapi bm25'], why: 'BM25 có tham số k1 ≈ 1.2 và b ≈ 0.75, mặc định từ ES 5.' },
    { t: 'fill', q: 'Điền: trong Postgres, kiểu dữ liệu lưu danh sách lexeme đã chuẩn hoá để full-text search là ___ (đi kèm index GIN).', a: ['tsvector'], why: 'tsvector kết hợp tsquery và toán tử @@, index bằng GIN.' },
    { t: 'open', q: 'Interviewer: "Users search components by name across 50 million rows and want ranked results. How do you design the search path and keep it consistent with the database?" Trả lời 4–6 câu.', a: 'Postgres vẫn là source of truth; dựng Elasticsearch làm derived index với mapping có analyzer phù hợp (lowercase, stemming, edge n-gram cho prefix). Đồng bộ qua CDC (Debezium đọc WAL) hoặc outbox table để không bỏ sót cập nhật, dùng id của DB làm _id để indexing idempotent. Chấp nhận near real-time 1 giây, có job reindex định kỳ để sửa drift và so khớp số lượng document. Mọi query mang tenant_id trong filter context, routing theo tenant để giảm fan-out. Nếu dữ liệu thực ra chỉ vài triệu dòng thì nói rõ sẽ bắt đầu bằng tsvector/GIN trong Postgres để tránh pipeline.', keys: ['source of truth', 'cdc', 'outbox', 'near real-time', 'tenant'] }
  ]
},
{ id: 'B12', type: 'block', topic: 'storage', title: 'Lưu trữ file và object storage: S3, presigned URL, multipart, dedup, lifecycle, erasure coding', time: '110 phút',
  goal: 'Thiết kế luồng upload/download file qua object storage không đi qua API server (presigned URL, multipart, checksum), chọn lớp lưu trữ theo lifecycle, và giải thích được erasure coding so với replication 3x bằng con số chi phí.',
  md: `
### Vấn đề cần giải
- File SBOM 50 MB, ảnh, log, báo cáo PDF: nhét vào cột [[bytea]] trong Postgres thì backup phình, WAL phình, mỗi lần SELECT nhầm kéo cả file vào RAM, replication chậm. DB sinh ra cho dữ liệu nhỏ có cấu trúc, không cho blob.
- Cho file đi qua API server (client -> API -> storage) thì API trở thành nút cổ chai băng thông: 100 người upload 50 MB cùng lúc là 5 GB qua RAM/NIC của API, trong khi API chỉ cần biết metadata.
- File phải bền (durability) hơn cả DB: mất một bản ghi còn khôi phục từ log, mất file gốc của khách thì không. Cần lưu nhiều bản, nhiều AZ, với chi phí chấp nhận được.
- Vì thế có **object storage**: kho key -> blob, phẳng, HTTP, bền 11 số 9, rẻ (S3 Standard ~0,023 USD/GB/tháng), và API server chỉ giữ **metadata**.

### Cốt lõi
#### 1. Blob trong DB vs object storage
| Tiêu chí | Blob trong Postgres (bytea/large object) | Object storage (S3/MinIO) |
|---|---|---|
| Kích thước hợp lý | < 1 MB, ít file | Từ KB tới 5 TB mỗi object |
| Transaction với metadata | Có (atomic) | Không; cần pattern "ghi file trước, commit metadata sau" |
| Chi phí lưu trữ | Đắt (SSD DB, backup, replica nhân lên) | Rẻ, 11 số 9 durability |
| Băng thông | Qua connection pool DB, giới hạn | Song song không giới hạn thực tế, có CDN |
| Backup/restore | Dump chậm theo kích thước blob | Versioning, replication cross-region sẵn |
| Khi nào dùng | Avatar nhỏ, chứng chỉ, dữ liệu cần atomic tuyệt đối | Mọi file người dùng upload, log, export, backup |

#### 2. Mô hình S3
- **Bucket** (namespace toàn cầu) + **key** (chuỗi, có thể chứa "/" nhưng không có thư mục thật). Thiết kế key có prefix phân tán ([[tenant/yyyy/mm/hash]]) giúp list và lifecycle theo prefix.
- Consistency: trước 12/2020 S3 là eventual cho overwrite/delete; từ 12/2020 **strong read-after-write** cho mọi thao tác. Trong phỏng vấn nên nói rõ mốc này.
- **Versioning**: giữ mọi phiên bản object; xoá chỉ đặt delete marker. Chống xoá nhầm, cộng thêm Object Lock (WORM) cho dữ liệu pháp lý.
- **Server-side encryption**: SSE-S3 (key của AWS), SSE-KMS (key quản lý được, audit, có phí mỗi request), SSE-C (client cấp key). Mặc định bật SSE-S3; dữ liệu khách thường yêu cầu SSE-KMS.
- **Storage class / lifecycle**: Standard -> Standard-IA (sau 30 ngày) -> Glacier Instant/Flexible -> Deep Archive. Rule lifecycle tự chuyển và tự xoá; Glacier Flexible lấy lại mất phút tới giờ, Deep Archive 12 giờ.

#### 3. Presigned URL: upload/download thẳng
- API server **ký** một URL bằng credential của mình, nhúng method/key/expiry (và tuỳ chọn content-type, content-length-range, checksum); client dùng URL đó PUT/GET thẳng vào S3 trong vài phút hiệu lực.
- API chỉ xử lý vài KB metadata thay vì cả file; băng thông và scale là của S3.
- Download: presigned GET với expiry ngắn (5–15 phút), hoặc CloudFront signed URL/cookie khi muốn CDN cache.
- Luồng upload an toàn:
  1. Client gọi [[POST /uploads]] với tên, size, sha256 dự kiến -> API tạo bản ghi metadata trạng thái **pending**, trả presigned PUT.
  2. Client PUT thẳng lên S3.
  3. Client gọi [[POST /uploads/{id}/complete]] -> API HEAD object kiểm tra size/checksum, đổi trạng thái **ready**, phát event xử lý.
  4. Job dọn: bản ghi pending quá 24 giờ mà object không tồn tại thì xoá; object tồn tại mà không có metadata thì xoá (orphan).

:::diagram
Client[Browser/CLI] -> API[API server] : 1. POST /uploads (metadata)
API -> DB[Postgres metadata] : insert pending
API -> Client : presigned PUT URL
Client -> S3[S3 / MinIO] : 2. PUT file thẳng
Client -> API : 3. complete
API -> S3 : HEAD size + checksum
API -> DB : status=ready
API -> MQ[RabbitMQ] : file.ready event
MQ -> Worker[Worker parse]
Worker -> S3 : GET object
CDN[CloudFront] -> S3 : origin
Client -> CDN : download public/signed
:::

#### 4. Multipart upload và resume
- Object > 100 MB nên dùng **multipart**: chia part 5 MB–5 GB (tối đa 10 000 part), upload song song, mỗi part có ETag; cuối cùng gọi CompleteMultipartUpload với danh sách ETag.
- Lợi ích: song song tăng throughput 5–10 lần; mất mạng chỉ upload lại part lỗi (**resume**); part có thể ký presigned riêng từng cái.
- Nhớ cấu hình lifecycle **AbortIncompleteMultipartUpload** sau 7 ngày: part mồ côi vẫn tính tiền và không hiện trong list object.
- **Checksum**: S3 hỗ trợ SHA-256/CRC32 ở cấp request; ETag của object multipart không phải MD5 của toàn file (là MD5 của các MD5 + "-N") nên đừng dùng ETag làm content hash.

#### 5. Dedup theo nội dung
- **Content-addressable storage**: key = hash nội dung (sha256). Hai tenant upload cùng file -> một object, metadata hai bản ghi trỏ chung, có **reference count** để biết khi nào xoá thật.
- Dedup toàn file đơn giản nhưng bỏ sót khi file đổi 1 byte. **Chunking** (fixed-size 4 MB hoặc content-defined chunking Rabin fingerprint) dedup ở cấp chunk — Dropbox/backup system dùng; đổi lấy độ phức tạp metadata (manifest file -> danh sách chunk hash).
- Dedup cross-tenant có rủi ro bảo mật: kẻ tấn công đoán hash để biết file đã tồn tại (side channel). Dropbox từng gặp; giải pháp là dedup trong phạm vi tenant hoặc luôn upload rồi mới dedup phía server.

#### 6. Erasure coding vs replication 3x
- Replication 3x: 1 TB dữ liệu tốn 3 TB đĩa (overhead 200%), chịu mất 2 bản. Đọc nhanh, phục hồi đơn giản.
- **Erasure coding** (Reed-Solomon) k+m: chia object thành k mảnh dữ liệu + m mảnh parity, mất tối đa m mảnh bất kỳ vẫn phục hồi. Ví dụ 10+4: overhead 40%, chịu mất 4 mảnh — bền hơn 3x mà tốn chưa bằng một nửa. MinIO mặc định EC trên các node/đĩa.
- Trả giá: ghi/đọc phải tính toán và chạm k node (độ trễ, CPU); phục hồi một mảnh phải đọc k mảnh khác (chi phí mạng lớn khi đĩa hỏng). Vì thế hot data nhỏ dùng replication, cold data lớn dùng EC.

#### 7. Metadata service và CDN
- Metadata (ai sở hữu, tên, size, hash, trạng thái, tenant_id, thời điểm hết hạn) ở Postgres; object storage chỉ biết key. Mọi quyền truy cập quyết định ở metadata service rồi mới ký URL.
- **CDN trước S3** cho download lặp lại (ảnh, package công khai): cache ở edge, giảm GET request S3 (0,0004 USD/1000 request không nhiều nhưng egress 0,09 USD/GB thì đáng kể), ẩn origin bằng Origin Access Control.
- **MinIO** self-host: API tương thích S3, chạy docker-compose cho dev/on-prem; production cần ≥ 4 node cho EC, và bạn tự lo durability, monitoring, nâng cấp — không có 11 số 9 miễn phí.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Durability S3 | 99,999999999% (11 số 9), object nhân bản ≥ 3 AZ |
| Giá S3 Standard (us-east-1) | ~0,023 USD/GB/tháng; Glacier Deep Archive ~0,00099 USD/GB/tháng |
| Egress ra Internet | ~0,09 USD/GB; GET ~0,0004 USD/1000 request |
| Multipart | part 5 MB–5 GB, tối đa 10 000 part, object tối đa 5 TB |
| Presigned URL | hết hạn tối đa 7 ngày (SigV4), thực tế dùng 5–60 phút |
| Overhead lưu trữ | replication 3x = 200%; EC 10+4 = 40% |
| S3 consistency | strong read-after-write từ 12/2020 |

### Sai lầm hay gặp
- Cho file đi qua API server rồi mới PUT lên S3: tốn RAM/băng thông API, timeout với file lớn, mất lợi ích scale của S3.
- Commit metadata "ready" trước khi object thực sự tồn tại (hoặc không có bước complete) -> bản ghi trỏ vào key rỗng; hoặc ngược lại, object tồn tại mãi mà không có metadata (orphan tốn tiền).
- Không có lifecycle abort multipart -> hàng trăm GB part mồ côi vô hình trong hoá đơn.
- Dùng ETag làm content hash cho object multipart.
- Presigned URL hết hạn quá dài, hoặc không ràng buộc content-length/content-type -> ai có URL cũng upload file 5 GB bất kỳ.
- Bucket public để "cho tiện" CDN thay vì Origin Access Control; đây là nguồn lộ dữ liệu số 1 trên cloud.
- Tin rằng MinIO một node trên EC2 là "S3 của mình" — không có durability nếu đĩa hỏng.

### Nói thế nào trong phỏng vấn (EN)
- "Files go to object storage; the database only stores metadata and a pointer to the key." — File vào object storage, DB chỉ lưu metadata và key.
- "Clients upload directly to S3 using a presigned URL, so the API server never touches the bytes." — Client upload thẳng bằng presigned URL, API không chạm vào dữ liệu.
- "For anything over 100 MB I would use multipart upload, which gives parallelism and resumability for free." — Trên 100 MB dùng multipart để song song và resume.
- "I would commit the metadata as pending first, and flip it to ready only after verifying the object exists and its checksum matches." — Ghi pending trước, xác minh object rồi mới chuyển ready.
- "Erasure coding with 10 data and 4 parity shards gives 40 percent overhead versus 200 percent for triple replication, at the cost of reconstruction bandwidth." — EC 10+4 overhead 40% so với 200% của 3x, đổi lấy chi phí phục hồi.
- "I would put a CDN in front of the bucket for repeated downloads and keep the bucket private with origin access control." — CDN trước bucket cho download lặp lại, bucket vẫn private.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Kiểm tra luồng upload SBOM hiện tại: file CycloneDX/SPDX có đi qua apiserver (multipart form) rồi mới đẩy MinIO/S3 không? Đo RAM apiserver khi 10 người upload file 50 MB cùng lúc. Nếu file đi qua API, đề xuất presigned PUT + endpoint complete; apiserver chỉ validate metadata và phát event parse.
- Bản ghi upload nên có trạng thái pending/ready/failed và job dọn orphan; đối chiếu với t_projects/revision hiện có để xem có trường hợp "revision tồn tại nhưng file không có" hay ngược lại.
- Dedup theo sha256 của file SBOM trong phạm vi tenant: khách Nhật hay re-upload cùng file nhiều lần mỗi ngày (scheduled CI); cùng hash -> bỏ qua parse, tiết kiệm cả enrichment. Không dedup cross-tenant để tránh side channel và lặp lại bài học leak cross-tenant (sự cố #15).
- Lifecycle: file SBOM gốc sau 90 ngày chuyển IA, sau 1 năm Glacier; export/report tạm hết hạn sau 7 ngày (presigned GET 15 phút). Bật versioning cho bucket SBOM gốc vì đây là bằng chứng tuân thủ của khách.
- Export lớn (sự cố #11: OFFSET + FDW + ReadAll vào RAM): stream kết quả ghi thẳng lên S3 bằng multipart từ worker, trả cho người dùng presigned GET khi xong; apiserver không giữ file trong RAM và không bị timeout 90 s.
- MinIO trên EC2 docker-compose (một node) không có durability thật: kiểm tra có backup/replication sang S3 không; viết vào runbook rủi ro này nếu chưa có.
- Presigned PUT phải ràng buộc [[content-length-range]] (ví dụ tối đa 200 MB) và content-type; thiếu ràng buộc thì một CI token bị lộ có thể đổ hàng TB vào bucket của bạn và hoá đơn tháng sau mới biết.
- Việc tuần này: đo kích thước bucket theo prefix tenant, bật rule AbortIncompleteMultipartUpload 7 ngày, kiểm tra bucket không public, và viết ADR "upload trực tiếp qua presigned URL".
`,
  quiz: [
    { t: 'mc', q: 'Lợi ích chính của presigned URL khi upload file là gì?', o: ['Client ghi thẳng lên S3 nên API server không phải chuyển tiếp byte, băng thông/scale thuộc về S3', 'File được mã hoá đầu cuối tự động', 'S3 tự tạo bản ghi metadata trong Postgres', 'Không cần xác thực người dùng ở API nữa'], a: 0, why: 'API chỉ ký URL với quyền hạn hẹp và thời hạn ngắn; dữ liệu đi thẳng client -> S3.' },
    { t: 'mc', q: 'Erasure coding 10+4 so với replication 3x: phát biểu nào đúng?', o: ['EC overhead 200%, replication 40%', 'Cả hai overhead như nhau, EC chỉ nhanh hơn khi đọc', 'EC overhead 40%, chịu mất 4 mảnh bất kỳ; replication 3x overhead 200%, chịu mất 2 bản', 'EC không dùng được cho object lớn'], a: 2, why: 'EC trả giá bằng CPU và băng thông phục hồi (đọc k mảnh để dựng lại 1 mảnh), đổi lấy chi phí lưu trữ thấp hơn nhiều.' },
    { t: 'mc', q: 'Vì sao nên tạo bản ghi metadata ở trạng thái pending trước khi client upload và chỉ chuyển ready sau bước complete?', o: ['Để S3 biết trước kích thước file', 'Để presigned URL không hết hạn', 'Vì S3 yêu cầu đăng ký key trước khi PUT', 'Để tránh bản ghi trỏ tới object không tồn tại và phát hiện orphan ở cả hai phía'], a: 3, why: 'Không có transaction giữa DB và S3, nên dùng trạng thái + xác minh HEAD object + job dọn để đạt nhất quán cuối.' },
    { t: 'mc', q: 'Bạn thấy hoá đơn S3 tăng dù tổng dung lượng object trong list không đổi. Nguyên nhân khả dĩ nhất?', o: ['Replication cross-region đang bật', 'Part của multipart upload chưa complete bị bỏ lại, không hiện trong list object nhưng vẫn tính tiền', 'Versioning bị tắt', 'CDN cache miss quá nhiều'], a: 1, why: 'Cần lifecycle rule AbortIncompleteMultipartUpload (thường 7 ngày) để dọn part mồ côi.' },
    { t: 'mc', q: 'Dedup file theo content hash cross-tenant tiềm ẩn rủi ro nào?', o: ['Hash collision làm hỏng dữ liệu thường xuyên', 'Không thể xoá file nào vì reference count luôn dương', 'Kẻ tấn công có thể dò xem một file cụ thể đã tồn tại trong hệ thống (side channel) bằng cách gửi hash', 'S3 không cho phép hai metadata trỏ cùng key'], a: 2, why: 'Dropbox từng gặp; nên dedup trong phạm vi tenant hoặc upload xong mới dedup phía server.' },
    { t: 'fill', q: 'Điền: khi object lớn hơn ~100 MB, S3 khuyến nghị dùng ___ upload để chia file thành nhiều part upload song song và resume được.', a: ['multipart', 'multipart upload'], why: 'Part 5 MB–5 GB, tối đa 10 000 part, hoàn tất bằng CompleteMultipartUpload với danh sách ETag.' },
    { t: 'fill', q: 'Điền: tính năng S3 giữ lại mọi phiên bản object và chỉ đặt delete marker khi xoá, dùng để chống xoá nhầm, gọi là ___.', a: ['versioning', 'object versioning', 's3 versioning'], why: 'Kết hợp Object Lock cho yêu cầu WORM/pháp lý.' },
    { t: 'open', q: 'Interviewer: "Design the upload path for a service where users upload files up to 2 GB. How do you keep the API servers thin and the metadata consistent with storage?" Trả lời 4–6 câu.', a: 'API tạo bản ghi metadata pending (tenant, tên, size, hash dự kiến) và trả presigned URL; với 2 GB thì khởi tạo multipart và ký từng part để client upload song song, resume part lỗi. Client gọi complete; API xác minh object bằng HEAD (size, checksum) rồi đổi trạng thái ready và phát event xử lý. Job định kỳ dọn bản ghi pending quá hạn và object mồ côi, cộng lifecycle AbortIncompleteMultipartUpload. Download qua presigned GET ngắn hạn hoặc CDN signed URL, bucket luôn private. Nếu được hỏi về chi phí lưu trữ lâu dài, chuyển lớp IA/Glacier bằng lifecycle và dùng erasure coding ở tầng storage.', keys: ['presigned', 'multipart', 'pending', 'checksum', 'lifecycle'] }
  ]
},
{ id: 'B13', type: 'block', topic: 'data', title: 'Xử lý dữ liệu lớn: batch (MapReduce/Spark), stream (Flink/Kafka Streams), window, watermark, lambda vs kappa; OLTP vs OLAP', time: '120 phút',
  goal: 'Phân biệt batch và stream processing bằng ví dụ cụ thể, giải thích event time vs processing time, window và watermark, chọn được giữa lambda và kappa, và biết khi nào dashboard nên đọc từ OLAP/materialized view thay vì query thẳng DB giao dịch.',
  md: `
### Vấn đề cần giải
- Dashboard "số vulnerability theo mức độ cho mọi project" chạy [[GROUP BY]] trên 10 triệu dòng t_vulnerabilities mỗi lần mở trang: 8 giây, ghim CPU của DB đang phục vụ transaction. Row store không sinh ra để quét 10 triệu dòng 3 cột.
- Báo cáo cuối tháng cần join 5 bảng, 500 GB: một máy không đủ RAM; cần chia việc cho nhiều máy rồi gộp lại — đó là **batch processing**.
- Cảnh báo "tenant này có > 100 lỗi parse trong 5 phút" không thể chờ job hằng đêm — đó là **stream processing**, với bài toán riêng: sự kiện đến muộn, đến sai thứ tự, và phải nhớ trạng thái mà không mất khi crash.
- Hai thế giới OLTP (giao dịch, dòng nhỏ, index) và OLAP (phân tích, quét cột, aggregate) khác nhau về cấu trúc lưu trữ, nên tồn tại hai loại hệ thống và đường ống nối chúng (ETL/ELT).

### Cốt lõi
#### 1. Batch: MapReduce và Spark
- **MapReduce** (Google 2004): map(record) -> (key, value); hệ thống **shuffle** gom cùng key về một máy; reduce(key, values) -> kết quả. Ví dụ đếm vulnerability theo severity: map phát (severity, 1), reduce cộng. Shuffle là bước đắt nhất: ghi đĩa + truyền mạng toàn bộ dữ liệu trung gian.
- Fault tolerance bằng cách chạy lại task lỗi (input bất biến trên HDFS); task chậm thì chạy bản sao (speculative execution).
- **Spark**: giữ dữ liệu trung gian trong RAM (RDD/DataFrame), lập kế hoạch nhiều bước thành DAG, giảm số lần ghi đĩa -> nhanh hơn Hadoop MapReduce 10–100 lần cho job nhiều bước. Vẫn có shuffle ở các bước groupBy/join; tối ưu chính là giảm shuffle (broadcast join bảng nhỏ, partition theo key join).
- Batch cho kết quả **đúng và đầy đủ** vì thấy toàn bộ dữ liệu, nhưng độ trễ bằng chu kỳ chạy (giờ/ngày).

#### 2. Stream: thời gian là vấn đề
- **Event time** (lúc sự kiện xảy ra, ghi trong payload) vs **processing time** (lúc hệ thống xử lý). Chúng lệch nhau vì mạng, retry, thiết bị offline, backlog queue. Thống kê theo processing time cho kết quả đổi theo tốc độ xử lý — sai về nghĩa.
- **Window** chia dòng sự kiện vô hạn thành các khoảng hữu hạn để aggregate:
  - Tumbling: cố định, không chồng (mỗi 5 phút).
  - Sliding: kích thước 5 phút, bước 1 phút (chồng nhau).
  - Session: nhóm theo khoảng im lặng (gap 30 phút) — độ dài động theo người dùng.
- **Watermark**: lời khẳng định "sẽ không còn sự kiện nào có event time < T nữa" (thường T = max event time đã thấy − độ trễ cho phép). Khi watermark vượt cuối window, window **đóng** và phát kết quả. Watermark là trade-off giữa độ trễ kết quả và độ đầy đủ.
- **Late data**: sự kiện đến sau khi window đóng. Lựa chọn: bỏ, hoặc giữ window thêm **allowed lateness** và phát kết quả cập nhật (retraction/upsert xuống sink), hoặc ghi vào side output để batch sửa sau.
- **State** và **exactly-once**: aggregate phải nhớ trạng thái (tổng, tập đã thấy). Flink chụp **checkpoint** định kỳ (Chandy-Lamport barrier) ra S3; crash thì khôi phục state + tua lại offset Kafka về checkpoint -> mỗi sự kiện ảnh hưởng state đúng một lần. Exactly-once tới sink ngoài cần sink idempotent hoặc transactional (two-phase commit).
- Kafka Streams: thư viện trong ứng dụng, state ở RocksDB local + changelog topic, dễ vận hành hơn Flink nhưng gắn chặt với Kafka.

:::diagram
Src[Events - upload, scan, violation] -> Kafka[Kafka / RabbitMQ]
Kafka -> Stream[Flink / Kafka Streams]
Stream -> State[State + checkpoint S3]
Stream -> Serve[Serving store - Redis / Postgres MV] : window result
Kafka -> Lake[Data lake - S3 Parquet] : raw append
Lake -> Batch[Spark batch nightly]
Batch -> DW[Warehouse - ClickHouse / Redshift]
DW -> Dash[Dashboard]
Serve -> Dash : near real-time
:::

#### 3. Lambda vs Kappa
| | Lambda | Kappa |
|---|---|---|
| Ý tưởng | Hai đường: batch (đúng, chậm) + speed layer (gần đúng, nhanh); serving gộp | Một đường stream; cần tính lại thì replay log từ đầu |
| Ưu | Batch sửa lỗi của stream; dễ tin cậy | Một codebase, một ngữ nghĩa; không viết logic hai lần |
| Nhược | Viết và bảo trì logic 2 lần, 2 hệ thống, kết quả có thể lệch | Replay dài tốn thời gian/chi phí; retention log phải đủ lâu |
| Khi chọn | Logic phức tạp cần kiểm chứng, dữ liệu lịch sử rất lớn | Khi stream engine đã có exactly-once state tốt (Flink), team nhỏ |

- Xu hướng: kappa với stream engine mạnh + lưu raw event ở data lake để backfill bằng batch khi cần ("kappa + backfill").

#### 4. OLTP vs OLAP
| | OLTP (Postgres, MySQL) | OLAP (ClickHouse, Redshift, BigQuery, Parquet) |
|---|---|---|
| Lưu trữ | Row store: một dòng liền nhau | Column store: một cột liền nhau, nén 5–10× |
| Truy vấn điển hình | Lấy/sửa vài dòng theo khoá | Quét triệu dòng, 3–5 cột, aggregate |
| Index | B-tree, point lookup | Sparse index, partition pruning, vectorized scan |
| Ghi | Nhiều ghi nhỏ, transaction | Ghi theo lô lớn, append; update/delete đắt |
| Concurrency | Hàng nghìn tx/giây | Vài chục query nặng đồng thời |

- **Parquet**: định dạng file cột, chia row group, có thống kê min/max mỗi cột để bỏ qua block. Là "lingua franca" của data lake trên S3.
- **Data warehouse** (schema chuẩn, SQL, quản trị) vs **data lake** (file thô trên S3, schema-on-read, rẻ) vs lakehouse (Iceberg/Delta: bảng ACID trên lake).
- **ETL** (biến đổi trước khi nạp, công cụ riêng) vs **ELT** (nạp thô vào warehouse, biến đổi bằng SQL trong warehouse — dbt). ELT thắng khi warehouse rẻ và mạnh; ETL còn chỗ khi phải ẩn PII trước khi nạp.

#### 5. Pre-aggregation và dashboard "gần real-time"
- **Materialized view** trong Postgres: tính sẵn aggregate; [[REFRESH MATERIALIZED VIEW CONCURRENTLY]] cần unique index, vẫn tính lại toàn bộ. Hợp khi dữ liệu nguồn vài triệu dòng và chấp nhận trễ 5–15 phút.
- **Incremental aggregate**: bảng metrics cập nhật theo delta khi sự kiện đến (UPSERT +1/−1) — đúng tới giây nhưng phải đảm bảo mỗi sự kiện tính một lần (idempotent theo event id).
- Lựa chọn theo yêu cầu độ trễ:
  - Trễ giờ/ngày: batch Spark -> warehouse.
  - Trễ phút: materialized view refresh theo lịch hoặc bảng snapshot do worker tính.
  - Trễ giây: stream aggregate -> Redis/Postgres serving table.
- Dashboard **không** nên query thẳng bảng giao dịch lớn; nếu bắt buộc, dùng read replica và timeout riêng.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Nén column store so với row store | 5–10× (dữ liệu lặp, kiểu đồng nhất) |
| Spark vs Hadoop MapReduce | nhanh hơn 10–100× cho job nhiều bước nhờ in-memory |
| Checkpoint Flink | thường 10 s–vài phút; càng dày càng ít replay nhưng tốn I/O |
| Parquet row group | thường 128 MB–1 GB; có min/max stats để prune |
| Kafka retention cho kappa | ngày tới tuần; replay 1 TB mất hàng giờ |
| Materialized view refresh | hợp khi nguồn vài triệu dòng, trễ 5–15 phút chấp nhận |

### Sai lầm hay gặp
- Tính aggregate theo processing time rồi thắc mắc vì sao số liệu đổi khi hệ thống chạy chậm lại.
- Không có watermark/allowed lateness: hoặc chờ vô hạn, hoặc bỏ hết sự kiện muộn mà không đo được bao nhiêu phần trăm bị bỏ.
- Nghĩ exactly-once của Flink/Kafka tự động đúng tới hệ thống ngoài; sink không idempotent thì vẫn ghi trùng khi khôi phục.
- Chạy dashboard aggregate trực tiếp trên DB OLTP sản xuất, sau đó "sửa" bằng cách tăng CPU DB.
- Chọn lambda rồi để hai đường logic lệch nhau; không ai còn biết số nào đúng.
- Materialized view refresh toàn bộ mỗi phút trên bảng 100 triệu dòng — tốn hơn cả query gốc.
- Ghi update/delete từng dòng vào ClickHouse/Redshift như vào Postgres.

### Nói thế nào trong phỏng vấn (EN)
- "Analytics queries should not hit the transactional database; I would move them to a column store or a precomputed table." — Query phân tích không nên đánh vào DB giao dịch; chuyển sang column store hoặc bảng tính sẵn.
- "In stream processing I aggregate by event time and use a watermark to decide when a window is complete." — Stream aggregate theo event time, dùng watermark để biết window đã đủ.
- "Late events beyond allowed lateness go to a side output and are reconciled by a nightly batch." — Sự kiện quá muộn vào side output, batch đêm đối chiếu lại.
- "Exactly-once in Flink covers internal state via checkpoints; for the sink I still need idempotent writes." — Exactly-once của Flink là cho state nội bộ; sink vẫn phải idempotent.
- "I would prefer a kappa-style pipeline with raw events kept in the lake for backfill, instead of maintaining two codebases." — Ưu tiên kappa và giữ raw event để backfill thay vì hai codebase.
- "For a dashboard that tolerates a few minutes of staleness, a periodically refreshed materialized view is the cheapest option." — Dashboard chịu trễ vài phút thì materialized view refresh định kỳ là rẻ nhất.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Dashboard vulnerability distribution hiện đọc snapshot t_project_metrics do upload chain tính một lần; khi chain gãy (Lambda chết giữa chừng) thì không có số liệu. Đây là bài toán "pre-aggregation không có đường sửa": bổ sung job reconcile định kỳ tính lại metrics cho project có finished_at mới hơn metrics (batch sửa stream — đúng tinh thần lambda nhỏ).
- Sự cố #6 (238 policy đánh giá liên tục trên bảng 9,6 triệu dòng, DB 4 vCPU ghim 100%) là OLTP bị ép làm OLAP. Hướng: đánh giá policy theo sự kiện (component mới, vulnerability mới) thay vì quét toàn bộ, và lưu kết quả aggregate theo tenant/project vào bảng snapshot.
- Hỏi PO: "Gần real-time" cho dashboard là bao nhiêu? Nếu 15 phút chấp nhận được thì materialized view hoặc bảng snapshot do worker tính sau mỗi scan là đủ; không cần Flink. Ghi con số này vào ADR để không ai đòi real-time ngầm.
- Feed OSV/NVD/GHSA về bản chất là stream sự kiện vulnerability (event time = published/modified). Việc so sánh theo thời điểm sync (processing time) là lý do báo cáo "tuần này có bao nhiêu CVE mới" thay đổi khi sync chậm — hãy lưu cả published_at và synced_at, báo cáo theo published_at.
- Audit log và notification là append-only: ứng viên tốt để đẩy sang ClickHouse/Parquet trên S3 theo ngày thay vì giữ mãi trong Postgres; export báo cáo tuân thủ cho khách Nhật chạy trên bản sao cột, không chạm DB chính (giảm cả sự cố #11 export tốn RAM).
- Khi 1 tenant stress test 696k dòng (sự cố #16) đổ vào, pipeline tính metrics kiểu "quét toàn bộ tenant" sẽ chết; incremental aggregate theo event id với UPSERT là cách sống sót.
- Reconcile policy (sự cố #14) về bản chất là batch "diff toàn policy" đè lên kết quả stream từng lần eval: lần eval lỗi/0 kết quả xoá mềm violation tốt. Nguyên tắc stream: kết quả rỗng do lỗi không phải là kết quả — phải phân biệt "đánh giá xong, không vi phạm" với "đánh giá thất bại" bằng trạng thái run, và chỉ reconcile từ run thành công.
- Việc tuần này: (1) liệt kê mọi query GROUP BY/COUNT trên bảng > 1 triệu dòng mà FE gọi, đo p95; (2) thử một materialized view cho dashboard severity theo tenant và đo refresh time; (3) đề xuất chuẩn hoá event time trong các feed sync.
`,
  quiz: [
    { t: 'mc', q: 'Trong MapReduce, bước nào thường tốn kém nhất và vì sao?', o: ['Map, vì phải đọc toàn bộ input', 'Ghi output ra HDFS, vì phải replicate 3 lần', 'Reduce, vì chạy tuần tự trên một máy', 'Shuffle, vì phải ghi đĩa và truyền toàn bộ dữ liệu trung gian qua mạng để gom cùng key về một máy'], a: 3, why: 'Shuffle là lý do Spark tối ưu bằng broadcast join và partition theo key để giảm dữ liệu di chuyển.' },
    { t: 'mc', q: 'Watermark trong stream processing có ý nghĩa gì?', o: ['Dấu thời gian lúc hệ thống bắt đầu xử lý', 'Lời khẳng định rằng sẽ không còn sự kiện có event time nhỏ hơn T, dùng để quyết định đóng window', 'Giới hạn dung lượng state của một window', 'Khoảng cách tối đa giữa hai checkpoint'], a: 1, why: 'Watermark = max event time đã thấy trừ độ trễ cho phép; là trade-off giữa độ trễ và độ đầy đủ của kết quả.' },
    { t: 'mc', q: 'Flink đảm bảo exactly-once bằng checkpoint. Phát biểu nào đúng về sink ngoài (ví dụ Postgres)?', o: ['Sink phải idempotent hoặc dùng two-phase commit, nếu không khi khôi phục sẽ ghi trùng', 'Sink tự động exactly-once nhờ checkpoint', 'Chỉ cần tăng tần suất checkpoint là hết trùng', 'Exactly-once chỉ áp dụng cho Kafka Streams, không cho Flink'], a: 0, why: 'Checkpoint bảo vệ state nội bộ và offset; ghi ra ngoài giữa hai checkpoint có thể lặp lại sau khi replay.' },
    { t: 'mc', q: 'Dashboard aggregate 10 triệu dòng mất 8 giây và ghim CPU DB giao dịch. Cách tiếp cận hợp lý nhất?', o: ['Tăng số vCPU của DB primary', 'Thêm index B-tree trên cột severity', 'Tính sẵn aggregate (materialized view/bảng snapshot/column store) và để dashboard đọc từ đó, chấp nhận độ trễ đã thoả thuận', 'Chuyển dashboard sang query mỗi 30 giây để cache ở FE'], a: 2, why: 'Row store không hợp quét lớn; pre-aggregation hoặc OLAP tách tải khỏi OLTP. Index B-tree không giúp aggregate toàn bảng.' },
    { t: 'mc', q: 'Nhược điểm chính của kiến trúc lambda là gì?', o: ['Không xử lý được dữ liệu đến muộn', 'Phải viết và bảo trì cùng logic ở hai đường (batch và stream), kết quả có thể lệch nhau', 'Không thể replay dữ liệu lịch sử', 'Chỉ chạy được trên Hadoop'], a: 1, why: 'Kappa giải quyết bằng một đường stream + replay log; giữ raw event ở lake để backfill.' },
    { t: 'fill', q: 'Điền: loại window có kích thước cố định và không chồng lên nhau (ví dụ mỗi 5 phút một khoảng) gọi là ___ window.', a: ['tumbling', 'tumbling window'], why: 'Sliding chồng nhau theo bước, session theo khoảng im lặng.' },
    { t: 'fill', q: 'Điền: định dạng file lưu theo cột, có thống kê min/max mỗi row group để bỏ qua block, phổ biến trong data lake trên S3, là ___.', a: ['parquet', 'apache parquet'], why: 'Parquet nén 5–10× và cho phép đọc chỉ các cột cần thiết.' },
    { t: 'open', q: 'Interviewer: "We need a dashboard showing vulnerabilities per severity per tenant that is at most a few minutes stale, without hurting the transactional database. How would you build it?" Trả lời 4–6 câu.', a: 'Chốt với PO độ trễ chấp nhận (ví dụ 5 phút) rồi chọn pre-aggregation thay vì query trực tiếp. Phương án rẻ nhất: bảng metrics theo tenant/project được worker cập nhật incremental khi có sự kiện scan/vulnerability mới, idempotent theo event id, kèm job reconcile định kỳ tính lại toàn bộ cho project có thay đổi để sửa sai lệch. Nếu nguồn chỉ vài triệu dòng, materialized view refresh concurrently mỗi 5 phút là đủ. Khi khối lượng lớn hoặc cần nhiều chiều phân tích, đẩy sự kiện sang column store (ClickHouse) qua queue và cho dashboard đọc ở đó. Luôn tách đường đọc dashboard khỏi DB giao dịch, có timeout riêng.', keys: ['pre-aggregation', 'materialized view', 'incremental', 'idempotent', 'column store'] }
  ]
},
{ id: 'B14', type: 'block', topic: 'observability', title: 'Observability: log, metric, trace; cardinality; RED/USE; SLO và burn-rate alert; OpenTelemetry; profiling', time: '130 phút',
  goal: 'Thiết kế bộ tín hiệu quan sát cho một dịch vụ (log có cấu trúc, metric đúng kiểu và đúng cardinality, trace có context propagation), đặt alert theo triệu chứng và SLO burn rate, và dùng pprof để tìm nguyên nhân OOM/CPU trong Go.',
  md: `
### Vấn đề cần giải
- Hệ thống của bạn đã "chết im lặng" nhiều ngày: RabbitMQ publisher không reconnect sau khi broker bị recreate, mọi cron job vẫn chạy nhưng không publish gì, không lỗi, không ai biết (sự cố #1). Scheduled scan lỡ tick vì Watchtower redeploy (sự cố #9) — cũng không ai biết. Không có monitor nào hỏi câu **"bao lâu rồi không có thành công?"**.
- Worker OOM 5 GiB nhưng [[docker inspect]] báo [[OOMKilled=false]] (sự cố #3): dấu hiệu nằm ở heap profile và metric RSS theo thời gian, không nằm trong log.
- Khi có 500 lỗi/phút, câu hỏi đầu tiên là "tenant nào, endpoint nào, từ khi nào" — không có structured log và label hợp lý thì trả lời mất hàng giờ.
- Observability là khả năng **hỏi câu hỏi mới về hệ thống mà không phải deploy code mới**. Monitoring là biết hệ thống hỏng; observability là biết vì sao.

### Cốt lõi
#### 1. Ba trụ và bốn golden signal
| Tín hiệu | Trả lời câu gì | Chi phí | Giới hạn |
|---|---|---|---|
| Log | Chuyện gì đã xảy ra với request này | Cao (byte theo lưu lượng) | Khó aggregate, dễ ngập |
| Metric | Hệ thống đang thế nào theo thời gian | Thấp (cố định theo số series) | Mất chi tiết từng request |
| Trace | Request đi qua đâu, chậm ở đâu | Trung bình (sampling) | Cần propagation xuyên dịch vụ |

- Bốn golden signal (Google SRE): **latency, traffic, errors, saturation**. Mọi dashboard dịch vụ bắt đầu từ bốn thứ này.
- **RED** cho service: Rate, Errors, Duration. **USE** cho resource (CPU, đĩa, pool, queue): Utilization, Saturation, Errors. RED trả lời "người dùng có đau không", USE trả lời "cái gì sắp hết".

#### 2. Log có cấu trúc
- JSON mỗi dòng, có [[level]], [[ts]], [[trace_id]], [[tenant_id]], [[request_id]], [[msg]] và field riêng. Không nối chuỗi; field là dữ liệu để lọc và đếm.
- Level: DEBUG tắt ở prod; INFO cho sự kiện nghiệp vụ (upload nhận, scan xong); WARN cho bất thường tự phục hồi (retry); ERROR cho việc cần người xem. ERROR mà không ai xử lý là WARN bị đặt sai.
- Chi phí: 1000 RPS × 1 KB/log = 1 MB/s ≈ 86 GB/ngày. Giải pháp: **sampling** (giữ 100% lỗi, 1% thành công), log ở biên thay vì mỗi tầng, retention 7–30 ngày nóng rồi đẩy S3.
- Không log secret, token, PII; mask ở thư viện log, không trông cậy vào kỷ luật cá nhân.

#### 3. Metric: kiểu, cardinality, percentile
- **Counter** chỉ tăng (requests_total, errors_total) -> dùng [[rate()]]. **Gauge** lên xuống (queue_depth, goroutines, heap_bytes). **Histogram** chia bucket (request_duration_seconds) -> tính percentile phía server bằng [[histogram_quantile]]; **summary** tính percentile tại client, không cộng được giữa các instance.
- **Cardinality** = số tổ hợp label. 10 endpoint × 5 status × 3 method = 150 series: tốt. Thêm label [[tenant_id]] (2000 tenant) -> 300 000 series; thêm [[user_id]] hay [[request_id]] -> Prometheus chết (mỗi series ~ vài KB RAM + index). Quy tắc: label chỉ nhận giá trị **hữu hạn, biết trước**; tenant_id vào metric chỉ khi số tenant nhỏ hoặc chỉ cho top-N tenant, còn lại dùng log/trace để truy theo tenant.
- **Vì sao không dùng trung bình**: 99 request 10 ms + 1 request 10 s cho trung bình 110 ms — không mô tả ai cả. p50 là trải nghiệm điển hình, **p99** là trải nghiệm của 1% tệ nhất; với 100 request/trang, mỗi người dùng chạm p99 gần như chắc chắn. Percentile không cộng/trung bình được giữa các node; phải gộp histogram bucket rồi mới tính.

#### 4. Tracing và OpenTelemetry
- Một **trace** = cây các **span** (tên, start, duration, attributes, status) chia sẻ **trace_id**; span cha-con nối bằng parent span id. **Context propagation**: header [[traceparent]] (W3C) đi theo HTTP/gRPC/message header; trong Go đi qua [[context.Context]] — mất context là mất trace.
- **OpenTelemetry (OTel)**: chuẩn vendor-neutral cho cả trace/metric/log: SDK trong ứng dụng -> **Collector** (nhận, batch, sampling, bỏ attribute nhạy cảm, export) -> backend (Jaeger/Tempo/Datadog...). Collector tách ứng dụng khỏi vendor và là chỗ làm **tail-based sampling** (giữ trace lỗi/chậm sau khi đã thấy toàn bộ).
- Sampling: head-based 1–10% ở biên cho traffic lớn; luôn giữ 100% trace có lỗi; nhỏ hơn 100 RPS thì cứ 100%.
- Trace xuyên queue: nhét traceparent vào message header khi publish, consumer tạo span con với link — không có thì mọi job nền là hộp đen.

:::diagram
FE[Next.js] -> API[apiserver Go] : HTTP + traceparent
API -> DB[Postgres] : span db.query
API -> MQ[RabbitMQ] : publish + trace header
MQ -> Worker[worker Go] : consume, span con
Worker -> Lambda[AWS Lambda enrichment] : invoke + trace header
API -> OTel[OTel Collector] : traces, metrics, logs
Worker -> OTel
Lambda -> OTel
OTel -> Prom[Prometheus / Mimir] : metrics
OTel -> Tempo[Tempo / Jaeger] : traces
OTel -> Loki[Loki / ES] : logs
Prom -> Alert[Alertmanager] : burn-rate rule
Alert -> Oncall[On-call + runbook]
:::

#### 5. SLO và alert theo triệu chứng
- **SLI** (chỉ số, ví dụ tỉ lệ request thành công dưới 500 ms), **SLO** (mục tiêu, 99,9%/30 ngày), **error budget** (0,1% = 43 phút downtime/tháng). SLO là cơ sở để quyết định "deploy tiếp hay dừng để sửa độ tin cậy".
- Alert theo **triệu chứng** (người dùng đau: error rate, latency, "không có job thành công") thay vì **nguyên nhân** (CPU 80%, một pod restart). Nguyên nhân thì ghi dashboard; triệu chứng thì đánh thức người.
- **Burn rate** = tốc độ tiêu error budget so với mức cho phép. Burn rate 14,4 trong 1 giờ tiêu hết 2% budget tháng; alert multi-window: (1 giờ và 5 phút, ngưỡng 14,4) để báo nhanh, (6 giờ và 30 phút, ngưỡng 6) để báo sự cố âm ỉ. Cửa sổ ngắn dùng để **tắt** alert nhanh khi đã hết lỗi.
- Alert bắt buộc cho hệ thống có job nền: **"no success in N minutes"** — [[time() - max(job_last_success_timestamp) > N]], hoặc [[increase(jobs_succeeded_total[1h]) == 0]] trong giờ có lịch. Đây là alert duy nhất bắt được sự cố #1 và #9. Heartbeat ngược: job ping một dead-man switch; không ping thì báo.
- **Alert fatigue**: mỗi alert phải có runbook và một hành động; alert không ai làm gì trong 2 tuần thì xoá hoặc hạ xuống ticket. Mục tiêu < 2 page mỗi ca trực.

#### 6. Profiling Go và dashboard per-tenant
- [[net/http/pprof]] bật trên port nội bộ: [[/debug/pprof/heap]] (inuse_space — cái gì đang giữ RAM), [[/debug/pprof/profile]] (CPU 30 s), [[goroutine]] (leak), [[allocs]]. Xem bằng [[go tool pprof -http]].
- Sự cố #3 nhìn qua pprof: inuse_space tập trung ở slice [] Vulnerability từ Preload — bằng chứng để thay bằng phân trang/stream, không phải đoán.
- **Continuous profiling** (Pyroscope/Parca) lấy mẫu 1–2% CPU liên tục, cho phép so profile trước/sau deploy.
- Metric Go cần có: [[go_goroutines]], [[go_memstats_heap_inuse_bytes]], GC pause, số connection pool đang dùng/đợi, queue depth RabbitMQ, lag consumer.
- Dashboard per-tenant: không qua label metric (cardinality) mà qua log/trace aggregate theo [[tenant_id]] (Loki/ES), hoặc metric chỉ cho tenant top-20 theo lưu lượng.
- **Runbook** cho mỗi alert: ý nghĩa, cách xác nhận, lệnh kiểm tra, cách giảm thiểu, ai cần biết, link dashboard. Viết lúc bình tĩnh, dùng lúc 3 giờ sáng.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| 99,9% / tháng | 43 phút error budget; 99,99% = 4,3 phút |
| Burn rate multi-window | 14,4 (1 giờ/5 phút) và 6 (6 giờ/30 phút) |
| Chi phí series Prometheus | ~ vài KB RAM mỗi active series; triệu series = hàng chục GB |
| Log 1 KB × 1000 RPS | ~86 GB/ngày trước nén |
| Sampling trace | 1–10% ở biên, 100% cho lỗi, 100% khi < 100 RPS |
| Page mỗi ca trực | mục tiêu < 2 |

### Sai lầm hay gặp
- Chỉ alert theo nguyên nhân (CPU, RAM) nên hệ thống chết im lặng vì "mọi thứ đều xanh".
- Không có alert "no success in N minutes" cho cron/consumer; sự cố #1 và #9 là hệ quả trực tiếp.
- Đưa tenant_id/user_id/request_id vào label metric -> cardinality explosion, Prometheus OOM, mất luôn metric lúc cần.
- Báo cáo độ trễ bằng trung bình; hoặc lấy trung bình của các p99 từng node.
- Trace đứt ở ranh giới queue hoặc goroutine vì tạo [[context.Background()]] mới.
- Log ERROR cho mọi thứ, 10 000 dòng/phút, không ai đọc; log cả token/PII.
- Bật pprof nhưng không giới hạn ở network nội bộ; hoặc không bật nên lúc OOM chỉ còn cách đoán.
- Alert không có runbook, ngưỡng cố định không theo SLO, 30 alert một đêm -> tắt thông báo điện thoại.

### Nói thế nào trong phỏng vấn (EN)
- "I alert on symptoms tied to an SLO, like error-budget burn rate, and keep causes such as CPU on dashboards." — Alert theo triệu chứng gắn SLO (burn rate), nguyên nhân để trên dashboard.
- "For background jobs the critical alert is absence of success: no successful run in the expected window." — Với job nền, alert quan trọng nhất là không có lần chạy thành công trong cửa sổ kỳ vọng.
- "We report p99, not averages, and we aggregate histogram buckets before computing percentiles." — Dùng p99 không dùng trung bình; gộp bucket histogram trước khi tính percentile.
- "Metric labels must have bounded cardinality; per-tenant detail lives in logs and traces instead." — Label metric phải hữu hạn; chi tiết theo tenant nằm ở log/trace.
- "Trace context must be propagated through the message queue headers, otherwise async work becomes a black box." — Trace context phải đi qua header message queue, nếu không job nền là hộp đen.
- "When a Go service leaks memory I take a heap profile with pprof and look at inuse_space to find what holds the memory." — Go rò rỉ bộ nhớ thì lấy heap profile pprof, xem inuse_space.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Alert đầu tiên cần thêm trong tuần này: "không có scheduled scan thành công trong 2 giờ" và "không có message publish thành công từ apiserver trong 15 phút khi có cron chạy" — hai alert này bắt đúng sự cố #1 (publisher chết) và #9 (gocron lỡ tick). Cài đặt rẻ nhất: gauge [[job_last_success_timestamp{job}]] đẩy ra Prometheus, rule [[time() - job_last_success_timestamp > 7200]].
- Thêm metric RED cho apiserver theo route (template route, không phải URL thô) và USE cho connection pool Postgres (đang dùng/đợi) và queue depth RabbitMQ; sự cố #6 (DB ghim 100%, 55% request 500) sẽ hiện trước ở pool wait và p99 trước khi khách gọi.
- Bật [[net/http/pprof]] trên port nội bộ của worker và apiserver; thêm gauge RSS/heap_inuse. Với sự cố #3, heap profile sẽ chỉ thẳng vào Preload Vulnerabilities; cộng thêm memory limit container để OOM hiện rõ thay vì OOMKilled=false.
- Lambda enrichment: log structured có tenant_id, batch_id, coordinate; metric số dòng thành công/thất bại theo lý do (cd_fetch_error, no_locator...). Sự cố #7 (một coordinate hỏng cả batch, FetchBatch nuốt lỗi) chỉ nhìn thấy khi lỗi được đếm theo lý do, không bị nuốt.
- Propagate traceparent từ FE -> apiserver -> RabbitMQ header -> worker -> Lambda invoke payload; trace một lần upload sẽ cho thấy chain 15 phút gãy ở đâu (sự cố distribution thiếu metrics).
- Dashboard theo tenant: không gắn tenant_id vào metric (hệ có hàng trăm tenant); dùng Loki/ES query theo tenant_id từ log, metric chỉ cho top-20 tenant theo lưu lượng.
- Viết runbook cho 3 alert đầu: scan không chạy, enrichment pending tăng, DB pool wait cao — mỗi runbook có lệnh kiểm tra [[docker logs]], query psql, bước giảm thiểu (restart publisher, tạm tắt policy eval).
- Chốt SLO đầu tiên với PO: 99,5% request API thành công dưới 2 s theo tháng (36 giờ budget) — con số thực tế cho stack hiện tại, có cơ sở để bàn deploy tiếp hay dừng sửa.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao thêm label tenant_id (2000 giá trị) vào metric request_duration là nguy hiểm?', o: ['Prometheus không hỗ trợ label dạng chuỗi', 'Histogram không thể có nhiều hơn 3 label', 'Số series nhân lên hàng trăm nghìn, mỗi series tốn RAM và index, dễ làm Prometheus OOM đúng lúc cần', 'Label tenant_id làm sai lệch percentile'], a: 2, why: 'Cardinality = tích số giá trị các label; label chỉ nên nhận giá trị hữu hạn biết trước, chi tiết theo tenant để ở log/trace.' },
    { t: 'mc', q: 'Alert nào bắt được tình huống "mọi cron job vẫn chạy nhưng không publish gì nhiều ngày"?', o: ['Không có lần thành công nào (publish/scan) trong N phút so với lịch kỳ vọng', 'Số lỗi ERROR trong log tăng', 'CPU của container worker > 80%', 'Dung lượng đĩa RabbitMQ gần đầy'], a: 0, why: 'Hệ thống chết im lặng không sinh lỗi; chỉ alert theo sự vắng mặt của thành công mới phát hiện được.' },
    { t: 'mc', q: 'Vì sao không nên báo cáo độ trễ bằng trung bình?', o: ['Trung bình khó tính hơn percentile', 'Trung bình chỉ dùng cho counter', 'Prometheus không lưu được giá trị trung bình', 'Trung bình bị kéo bởi vài request rất chậm và không mô tả trải nghiệm của ai; p50 và p99 mô tả điển hình và đuôi'], a: 3, why: 'Với 100 request mỗi trang, hầu hết người dùng chạm p99; percentile phải tính từ histogram gộp, không trung bình các p99.' },
    { t: 'mc', q: 'Trong SLO burn-rate alerting, mục đích của cặp cửa sổ dài và ngắn (ví dụ 1 giờ và 5 phút) là gì?', o: ['Cửa sổ dài để báo sớm, cửa sổ ngắn để tính toán rẻ hơn', 'Cửa sổ dài tránh báo động vì nhiễu ngắn, cửa sổ ngắn giúp alert tắt nhanh khi lỗi đã hết', 'Hai cửa sổ để tính hai SLO khác nhau', 'Cửa sổ ngắn chỉ dùng cho log, cửa sổ dài cho metric'], a: 1, why: 'Multi-window burn rate cân bằng giữa phát hiện nhanh, ít nhiễu và thời gian phục hồi alert ngắn.' },
    { t: 'mc', q: 'Worker Go tăng RAM đến 5 GiB rồi bị giết. Bước điều tra hiệu quả nhất?', o: ['Tăng RAM máy chủ gấp đôi và theo dõi', 'Đọc toàn bộ log INFO của worker', 'Lấy heap profile qua pprof, xem inuse_space để biết cấu trúc dữ liệu nào đang giữ bộ nhớ', 'Giảm số goroutine xuống 1 và chờ'], a: 2, why: 'Heap profile chỉ thẳng vào nguồn cấp phát (ví dụ slice Preload); thay đổi code dựa trên bằng chứng chứ không đoán.' },
    { t: 'fill', q: 'Điền: bộ phương pháp giám sát dịch vụ gồm Rate, Errors, Duration gọi là phương pháp ___.', a: ['red', 'red method'], why: 'RED cho service; USE (Utilization, Saturation, Errors) cho resource.' },
    { t: 'fill', q: 'Điền: trong OpenTelemetry, thành phần trung gian nhận telemetry từ SDK, batch, sampling và export sang backend gọi là ___.', a: ['collector', 'otel collector', 'opentelemetry collector'], why: 'Collector tách ứng dụng khỏi vendor và là nơi làm tail-based sampling, lọc attribute nhạy cảm.' },
    { t: 'open', q: 'Interviewer: "Your background job pipeline silently stopped for three days last month. How would you make sure that never happens again?" Trả lời 4–6 câu.', a: 'Nguyên nhân là chỉ alert theo lỗi, còn pipeline chết kiểu không sinh lỗi. Thêm metric job_last_success_timestamp cho từng job và alert "no success in N minutes" theo lịch kỳ vọng, cộng dead-man switch heartbeat độc lập với hệ thống. Thêm metric throughput đầu ra (message published, scan completed) và alert khi bằng 0 trong khung giờ có lịch. Gắn alert với SLO để không bị fatigue, mỗi alert có runbook với bước kiểm tra publisher/broker. Cuối cùng là postmortem không đổ lỗi và test game day: tắt broker rồi xem alert có nổ trong 15 phút không.', keys: ['no success', 'last_success', 'heartbeat', 'runbook', 'symptom'] }
  ]
},
{ id: 'B15', type: 'block', topic: 'security', title: 'Bảo mật trong thiết kế: authn, session vs JWT, OAuth2/OIDC, RBAC/ABAC, multi-tenant isolation, TLS/mTLS, secrets, audit', time: '130 phút',
  goal: 'Chọn và bảo vệ được cơ chế xác thực/uỷ quyền phù hợp (session vs JWT, OAuth2 flow, RBAC/ABAC), thiết kế cách ly tenant ở tầng dữ liệu, quản lý secret và audit log đúng cách, và trả lời gọn các câu hỏi bảo mật trong phỏng vấn system design.',
  md: `
### Vấn đề cần giải
- Mọi hệ thống SaaS B2B đều bị hỏi ba câu: ai đang gọi (authentication), họ được làm gì (authorization), và dữ liệu khách A có bao giờ lọt sang khách B không (isolation). Trả lời sai câu thứ ba là mất khách Nhật ngay lập tức.
- Bảo mật không phải một tính năng thêm sau: lựa chọn JWT hay session quyết định cách bạn revoke; cách truyền tenant context quyết định có xảy ra IDOR hay không; cách nạp config quyết định secret có nằm trong image hay không (sự cố #2, #10: config/secret rơi vào mặc định localhost sau redeploy — cùng một gốc: cấu hình không được quản lý như dữ liệu quan trọng).
- Audit log là bằng chứng pháp lý, nhưng hệ thống của bạn từng mất log vì publish trước commit (sự cố #12). Bảo mật thiết kế = làm cho điều đúng là điều dễ nhất.

### Cốt lõi
#### 1. Session server-side vs JWT
| | Session (cookie id, state ở server/Redis) | JWT (stateless, ký) |
|---|---|---|
| Revoke | Tức thì: xoá session | Khó: phải chờ hết hạn hoặc giữ denylist (lại stateful) |
| Scale | Cần store chung (Redis); 1 lookup mỗi request | Không lookup; verify chữ ký ~50 µs |
| Kích thước | Cookie 32 byte | 500 B–2 KB mỗi request, header phình |
| Thông tin | Server có toàn quyền đổi | Claim đóng băng tới khi hết hạn (đổi role phải chờ) |
| Phù hợp | Web app cùng domain, cần logout tức thì | API giữa dịch vụ, mobile, nhiều domain |

- Thực tế phổ biến: **access token** JWT ngắn (5–15 phút) + **refresh token** dài, lưu server-side, **rotation** mỗi lần dùng (refresh token cũ dùng lại -> coi là bị đánh cắp, thu hồi cả chuỗi). Revoke = xoá refresh token; cửa sổ rủi ro tối đa bằng tuổi access token.
- JWT: dùng RS256/ES256 (public key verify ở mọi service), từ chối [[alg=none]], kiểm tra [[iss]], [[aud]], [[exp]]; không nhét dữ liệu nhạy cảm vào payload (chỉ base64, không mã hoá).
- Cookie: [[HttpOnly]], [[Secure]], [[SameSite=Lax/Strict]]; CSRF token nếu dùng cookie cho API đổi trạng thái.

#### 2. OAuth2, OIDC, SSO
- OAuth2 là **uỷ quyền** (cho app X quyền truy cập tài nguyên của tôi), không phải xác thực. **OIDC** đặt lên trên OAuth2 thêm **id_token** (JWT về danh tính) và endpoint userinfo -> dùng cho login.
- Flow cần biết:
  - **Authorization code + PKCE**: cho web/SPA/mobile. Browser nhận code, backend (hoặc client với PKCE verifier) đổi code lấy token. Implicit flow đã bị loại bỏ.
  - **Client credentials**: machine-to-machine, không có người dùng; service lấy token bằng client id/secret.
  - Device code: TV/CLI.
- **SSO** doanh nghiệp: khách Nhật thường yêu cầu SAML hoặc OIDC với IdP của họ (Azure AD/Entra, Okta). Bạn là Service Provider: nhận assertion, map sang user nội bộ theo email/sub, **just-in-time provisioning**, SCIM để đồng bộ user/role khi nghỉ việc.

#### 3. Authorization: RBAC, ABAC, policy engine
- **RBAC**: user -> role -> permission. Dễ hiểu, dễ audit, đủ cho 80% SaaS: Owner/Admin/Member/Viewer theo tenant (và theo project nếu cần). Hạn chế: bùng nổ role khi điều kiện phức tạp ("chỉ sửa project mình tạo trong giờ hành chính").
- **ABAC**: quyết định theo thuộc tính subject/resource/environment. Linh hoạt, khó debug. **ReBAC** (Zanzibar/SpiceDB): quan hệ đồ thị, hợp cho chia sẻ kiểu Google Docs.
- **Policy engine** (OPA/Rego, Cedar): tách luật khỏi code, test được, một chỗ sửa. Giá: thêm thành phần, độ trễ ~ms mỗi quyết định, cần cache.
- Nguyên tắc: **deny by default**, check ở server (không tin FE ẩn nút), check ở tầng service chứ không rải ở controller.

#### 4. Cách ly tenant và IDOR
- **IDOR** (Insecure Direct Object Reference): [[GET /projects/123]] trả về project của tenant khác vì chỉ check đăng nhập, không check sở hữu. Đây là lỗi phổ biến nhất của SaaS multi-tenant.
- Phòng thủ nhiều lớp:
  1. **Tenant context** lấy từ token (claim) -> middleware gắn vào [[context]] -> **mọi** repository query có [[WHERE tenant_id = $1]]. Không lấy tenant_id từ body/query param của client.
  2. **Row-level security** Postgres: [[CREATE POLICY ... USING (tenant_id = current_setting('app.tenant_id')::uuid)]]; connection pool phải [[SET LOCAL app.tenant_id]] mỗi transaction. Quên WHERE vẫn an toàn — đây là lưới bảo hiểm, không thay thế lớp 1.
  3. Id không đoán được (UUIDv7 thay vì số tự tăng) giảm dò quét nhưng **không** thay thế authz.
- Shared schema + tenant_id (rẻ, migration một lần) vs schema/database per tenant (cách ly mạnh, ops nặng): chi tiết ở bài B19. Dữ liệu dùng chung (vulnerability DB) phải tách rõ với dữ liệu riêng; sự cố #15 (first-writer-wins ghi đè license declared cross-tenant) là lỗi isolation ở tầng dữ liệu dùng chung.

:::diagram
User[User / CI] -> IdP[IdP - Entra / Okta] : OIDC login
IdP -> FE[Next.js] : code
FE -> API[apiserver] : access token JWT
API -> AuthMW[Auth middleware] : verify sig, exp, aud
AuthMW -> TenantCtx[tenant_id vao context]
TenantCtx -> Authz[Authz - RBAC / OPA]
Authz -> Repo[Repository - WHERE tenant_id]
Repo -> PG[Postgres + RLS]
API -> Vault[Vault / SSM] : secrets at startup
API -> Audit[Audit log append-only] : after commit
Worker[worker] -> API : mTLS
:::

#### 5. Transport, secrets, dữ liệu nghỉ
- **TLS** mọi nơi, kể cả nội bộ; TLS 1.2+ (ưu tiên 1.3), cert tự động (ACME/cert-manager). **mTLS** service-to-service: hai bên xác thực bằng cert -> service identity không cần password; service mesh (Istio/Linkerd) làm hộ, hoặc SPIFFE/SPIRE.
- **Secrets**: không bake vào image, không commit, không in log. Nguồn: Vault, AWS SSM Parameter Store/Secrets Manager; nạp lúc khởi động hoặc sidecar; **rotation** định kỳ và ngay khi nghi lộ. Image chỉ chứa code; config qua env/ConfigMap; secret qua secret store. Sự cố #2 (Lambda mất env sau redeploy) là bài học: env là **cấu hình quan trọng** phải được IaC quản lý và kiểm tra lúc khởi động — thiếu biến bắt buộc thì **fail fast**, không fallback localhost.
- **Encryption at rest**: EBS/RDS/S3 bật SSE-KMS; cột cực nhạy (API key khách) mã hoá ở ứng dụng (envelope encryption: data key mã hoá bằng KMS master key).
- **Password hashing**: bcrypt (cost 10–12, ~100 ms) hoặc **argon2id** (memory-hard, chống GPU); không MD5/SHA-256 trơn, salt riêng từng user (các thuật toán trên tự có). Chỉ lưu hash.

#### 6. Input, injection, webhook, rate limit
- **SQL injection**: luôn parameterized query ([[$1]]); ORM không miễn nhiễm khi nối chuỗi ORDER BY/tên cột — whitelist tên cột.
- **SSRF**: tính năng "nhập URL để fetch" (webhook test, import SBOM từ URL) có thể gọi [[169.254.169.254]] lấy credential EC2. Chặn IP private/link-local, resolve DNS rồi kiểm tra lại, egress qua proxy.
- Validate input ở biên theo schema (kích thước file, kiểu, độ dài); XML/JSON bomb; path traversal khi lưu file theo tên người dùng gửi.
- **API key** cho CI: lưu hash của key, hiện một lần, prefix để nhận diện, scope hẹp, hết hạn. **Webhook ký HMAC** (SHA-256 với secret chia sẻ, kèm timestamp chống replay ±5 phút); người nhận verify trước khi parse.
- **Audit log bất biến**: ai, làm gì, trên gì, khi nào, từ IP nào, kết quả; **ghi sau khi commit** (hoặc trong cùng transaction qua outbox) — sự cố #12 publish trước commit làm consumer gặp FK violation và mất log. Lưu append-only (bảng không UPDATE/DELETE cho role app, hoặc S3 Object Lock), retention theo hợp đồng (thường 1–7 năm).
- **Rate limit** chống abuse: theo API key/tenant/IP, cho login (5 lần/phút) và endpoint đắt (upload, export). Trả [[429]] kèm [[Retry-After]].

#### 7. OWASP Top 10 (2021) — bảng nhanh
| Hạng mục | Phòng thủ chính trong thiết kế |
|---|---|
| Broken Access Control | Deny by default, check sở hữu + tenant mọi request, RLS |
| Cryptographic Failures | TLS, KMS at rest, argon2/bcrypt, không tự chế crypto |
| Injection | Parameterized query, whitelist, validate schema |
| Insecure Design | Threat model, abuse case, rate limit |
| Security Misconfiguration | Config as code, không default credential, fail fast khi thiếu env |
| Vulnerable Components | SBOM + scan dependency (chính sản phẩm của bạn), pin version |
| Identification/Authn Failures | MFA, rotation refresh token, lockout |
| Software/Data Integrity | Ký image, pin digest, verify webhook HMAC |
| Logging/Monitoring Failures | Audit bất biến, alert login bất thường |
| SSRF | Chặn IP nội bộ, egress proxy |

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Access token | 5–15 phút; refresh token ngày–tuần, rotation mỗi lần dùng |
| bcrypt cost | 10–12 (~100 ms mỗi hash); argon2id ~64 MB RAM |
| Verify JWT RS256 | ~50–100 µs; lookup session Redis ~0,5 ms |
| HMAC webhook | timestamp ±5 phút chống replay |
| Rate limit login | ~5 lần/phút/tài khoản, lockout tạm thời |
| Retention audit log | 1–7 năm tuỳ hợp đồng/quy định |

### Sai lầm hay gặp
- Dùng JWT dài hạn không có refresh/rotation rồi không revoke được khi nhân viên khách nghỉ việc.
- Lấy tenant_id từ request body hoặc query param thay vì từ token.
- Chỉ check "đã đăng nhập" mà không check sở hữu resource -> IDOR.
- Secret trong Dockerfile ENV, trong repo, hoặc in ra log lúc khởi động; thiếu env thì fallback localhost im lặng thay vì fail fast.
- Tự "mã hoá" password bằng SHA-256 + salt; hoặc so sánh chuỗi không constant-time cho HMAC/API key.
- Audit log có UPDATE/DELETE được bằng role của app; hoặc publish trước commit nên mất log.
- Tin header [[X-Forwarded-For]] để rate limit mà không cấu hình trusted proxy.
- Webhook test URL không chặn IP nội bộ -> SSRF tới metadata endpoint của cloud.

### Nói thế nào trong phỏng vấn (EN)
- "I would use short-lived access tokens with rotating refresh tokens stored server-side, so revocation takes effect within minutes." — Access token ngắn + refresh token rotation lưu server để revoke trong vài phút.
- "Tenant id comes from the token, is put into the request context by middleware, and every repository query filters on it; row-level security is the safety net." — Tenant id lấy từ token, middleware gắn vào context, mọi query lọc theo nó; RLS là lưới bảo hiểm.
- "Authorization is deny-by-default and enforced in the service layer, not in the UI." — Authz mặc định từ chối, thực thi ở tầng service.
- "Secrets come from a secret manager at startup; the service fails fast if a required variable is missing instead of falling back to a default." — Secret lấy từ secret manager, thiếu biến bắt buộc thì fail fast.
- "Audit events are written after the transaction commits, to an append-only store, because they are legal evidence." — Audit ghi sau commit vào kho append-only vì là bằng chứng pháp lý.
- "For enterprise customers I would support OIDC or SAML SSO with just-in-time provisioning and SCIM for deprovisioning." — Khách doanh nghiệp cần SSO OIDC/SAML, JIT provisioning và SCIM.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Kiểm tra tenant context: grep trong apiserver mọi repository method xem có method nào nhận tenant_id từ request body/param thay vì từ context lấy ra ở middleware không. Viết test tích hợp IDOR: user tenant A gọi [[GET /projects/{id của tenant B}]] phải 404/403 cho mọi endpoint có id.
- Thử RLS trên DB local: bật [[ENABLE ROW LEVEL SECURITY]] cho t_components, t_projects; connection pool [[SET LOCAL app.tenant_id]] mỗi transaction. Đo overhead (thường < 5%). Viết ADR "RLS là lưới bảo hiểm thứ hai". Lưu ý FDW và Lambda dùng role riêng nên cần policy BYPASS cho job hệ thống.
- Sự cố #2 và #10: viết hàm [[mustEnv()]] cho mọi biến bắt buộc (REDIS_HOST, RABBITMQ_URL, DB DSN) ở apiserver, worker và Lambda — thiếu thì panic lúc khởi động với thông báo rõ; không bao giờ default localhost. Secret chuyển sang SSM Parameter Store, IaC quản lý env Lambda.
- Sự cố #12: audit log hiện publish trước commit. Sửa thành outbox trong cùng transaction hoặc publish sau commit; bảng audit ở Bento/Mongo đặt role app chỉ INSERT; cân nhắc đẩy bản sao hằng ngày lên S3 Object Lock cho yêu cầu bất biến của khách Nhật.
- API key cho CI upload SBOM: lưu hash, prefix [[sbom_]], scope theo project, hết hạn; webhook notification ký HMAC-SHA256 kèm timestamp; tài liệu hoá cho khách cách verify.
- Login local từng bounce vì thiếu cột is_sso_only -> refresh 401: đây là nhắc nhở rằng luồng auth cần test smoke sau mỗi migration. Thêm vào checklist deploy.
- Bảng OWASP trên: hạng mục "Vulnerable Components" chính là sản phẩm của bạn — dùng chính hệ thống để quét image của apiserver/FE (bài học next 16.3.1 có 3 RCE) và ghi vào release note.
- Rate limit login 5 lần/phút/tài khoản + per-tenant limit cho upload/export; trả 429 với Retry-After; đo trước số request hợp lệ cao nhất của tenant lớn để không chặn nhầm CI của khách.
`,
  quiz: [
    { t: 'mc', q: 'Điểm yếu cốt lõi của JWT stateless so với session server-side là gì?', o: ['Không thể dùng qua HTTPS', 'Khó thu hồi trước khi hết hạn; muốn revoke phải thêm trạng thái (denylist) hoặc dùng access token ngắn + refresh token', 'Kích thước nhỏ hơn nên chứa ít thông tin', 'Chỉ dùng được với một domain'], a: 1, why: 'Vì vậy thực tế dùng access token 5–15 phút cộng refresh token rotation lưu server-side.' },
    { t: 'mc', q: 'Lỗi IDOR xảy ra khi nào?', o: ['Token JWT hết hạn nhưng vẫn được chấp nhận', 'Webhook không ký HMAC', 'Mật khẩu được hash bằng bcrypt với cost thấp', 'Endpoint chỉ kiểm tra người dùng đã đăng nhập mà không kiểm tra quyền sở hữu/tenant của resource được tham chiếu bằng id'], a: 3, why: 'Phòng thủ: tenant_id từ token vào context, mọi query lọc theo tenant, RLS làm lưới bảo hiểm.' },
    { t: 'mc', q: 'OAuth2 flow nào phù hợp cho một worker nội bộ gọi API của dịch vụ khác, không có người dùng tham gia?', o: ['Client credentials', 'Implicit flow', 'Authorization code + PKCE', 'Device code'], a: 0, why: 'Client credentials dành cho machine-to-machine; authorization code + PKCE cho ứng dụng có người dùng; implicit đã bị loại bỏ.' },
    { t: 'mc', q: 'Vì sao audit log nên được ghi sau khi transaction nghiệp vụ commit (hoặc qua outbox cùng transaction)?', o: ['Để giảm kích thước transaction', 'Vì RabbitMQ không cho publish trong transaction', 'Vì consumer có thể nhận event trước khi dữ liệu tồn tại, gây FK violation và mất log; audit là bằng chứng không được mất', 'Để audit log không chứa tenant_id'], a: 2, why: 'Publish trước commit tạo cửa sổ dữ liệu chưa tồn tại; outbox hoặc publish-after-commit đóng cửa sổ đó.' },
    { t: 'mc', q: 'Tính năng "nhập URL để import SBOM" trên server cloud có rủi ro nào và phòng thủ ra sao?', o: ['XSS; phòng bằng escape HTML', 'Replay attack; phòng bằng timestamp', 'SQL injection; phòng bằng parameterized query', 'SSRF tới địa chỉ nội bộ/metadata (169.254.169.254); phòng bằng chặn IP private, resolve rồi kiểm tra lại, egress proxy'], a: 3, why: 'SSRF có thể lấy credential của instance; validate URL theo IP sau khi resolve, không chỉ theo chuỗi.' },
    { t: 'fill', q: 'Điền: cơ chế Postgres cho phép định nghĩa policy lọc dòng theo tenant ngay ở tầng DB, làm lưới bảo hiểm khi code quên WHERE tenant_id, gọi là ___ (viết tắt RLS).', a: ['row-level security', 'row level security', 'rls'], why: 'Kết hợp SET LOCAL app.tenant_id mỗi transaction trên connection pool.' },
    { t: 'fill', q: 'Điền: mở rộng của OAuth2 cung cấp id_token và endpoint userinfo để dùng cho đăng nhập (xác thực danh tính) gọi là ___.', a: ['oidc', 'openid connect'], why: 'OAuth2 là uỷ quyền; OIDC thêm lớp danh tính cho login/SSO.' },
    { t: 'open', q: 'Interviewer: "How do you guarantee tenant isolation in a shared-database multi-tenant SaaS?" Trả lời 4–6 câu.', a: 'Nhiều lớp: tenant id lấy từ token đã verify, middleware gắn vào request context, không bao giờ nhận từ client input. Mọi repository query bắt buộc filter tenant_id, kiểm tra bằng test IDOR tự động cho mọi endpoint có id. Lớp hai là row-level security trong Postgres với SET LOCAL app.tenant_id mỗi transaction, nên quên WHERE vẫn không leak. Dữ liệu dùng chung (vulnerability feed) tách khỏi dữ liệu riêng, overlay theo tenant thay vì ghi đè chung. Cache key và search index cũng có tenant prefix, audit log ghi tenant cho mọi thao tác; tenant lớn hoặc yêu cầu cao có thể tách database riêng.', keys: ['tenant_id', 'context', 'row-level security', 'idor', 'cache'] }
  ]
},
{ id: 'B16', type: 'block', topic: 'design', title: 'Microservices vs monolith: ranh giới, giao tiếp, data ownership, API composition, strangler fig, modular monolith', time: '110 phút',
  goal: 'Lập luận được khi nào tách dịch vụ và khi nào không, vẽ ranh giới theo bounded context với data ownership rõ ràng, chọn sync hay async cho từng cạnh giao tiếp, và trình bày kế hoạch strangler fig để tách dần một monolith mà không dừng kinh doanh.',
  md: `
### Vấn đề cần giải
- Một codebase 500k dòng, 30 người cùng commit: build 20 phút, một thay đổi ở module báo cáo làm hỏng upload, deploy phải "đợi tất cả cùng xong". Tổ chức muốn team làm độc lập — đó là lý do số một người ta tách dịch vụ (định luật Conway).
- Ngược lại: team 6 người tách 12 microservice, mỗi request đi qua 5 hop mạng, một lỗi phải lần qua 5 log, một tính năng phải sửa 4 repo và deploy theo thứ tự. Đó là **distributed monolith**: trả mọi cái giá của phân tán mà không nhận lợi ích nào.
- Câu hỏi đúng không phải "microservice hay monolith" mà là: **ranh giới nào, ai sở hữu dữ liệu nào, cạnh nào sync, cạnh nào async**, và di chuyển ra sao mà không viết lại từ đầu.

### Cốt lõi
#### 1. Khi nào tách và cái giá
| Lý do tách (lợi) | Cái giá phải trả |
|---|---|
| Team độc lập deploy, release theo nhịp riêng | Mạng: mỗi hop +0,5–2 ms trong DC, lỗi partial, timeout/retry phải thiết kế |
| Scale khác nhau (parser ăn CPU, API ăn kết nối) | Consistency: không còn transaction xuyên module, cần saga/outbox |
| Cô lập lỗi: một module crash không kéo cả hệ | Debug: tracing, log tập trung là bắt buộc chứ không tuỳ chọn |
| Công nghệ khác nhau (Go worker, Python ML) | Ops: N pipeline CI/CD, N dashboard, N on-call surface, contract versioning |
| Ranh giới bảo mật/compliance riêng | Chi phí hạ tầng: mỗi service ít nhất 2 replica + sidecar |

- Rule of thumb: dưới ~10–15 engineer, một **modular monolith** gần như luôn đúng. Tách khi có **bằng chứng** (team chờ nhau deploy, một module cần scale 10× phần còn lại, một module cần ngôn ngữ khác), không tách vì "chuẩn ngành".

#### 2. Vẽ ranh giới: bounded context và data ownership
- **DDD bounded context**: vùng mà một thuật ngữ có đúng một nghĩa. "Component" trong ngữ cảnh SBOM parse (purl, version, hash) khác "Component" trong ngữ cảnh policy (đối tượng bị đánh giá) và trong ngữ cảnh billing (đơn vị tính tiền). Ranh giới dịch vụ đi theo ranh giới ngữ cảnh, không theo tầng kỹ thuật (không có "service DB", "service cache").
- **Database-per-service**: mỗi service sở hữu schema của mình; service khác chỉ đọc qua API hoặc event, **không share bảng**. Share DB = coupling ở schema: đổi cột là vỡ hàng xóm, không biết ai đọc gì, không scale riêng được.
- Dữ liệu cần ở hai nơi -> **replicate qua event** (service B giữ bản sao đọc của dữ liệu A theo nhu cầu riêng), chấp nhận eventual consistency vài trăm ms–giây.
- Dấu hiệu ranh giới sai: hai service luôn deploy cùng nhau; một thao tác nghiệp vụ cần transaction xuyên hai service; service "Entity" (UserService, OrderService chỉ là CRUD bọc bảng).

#### 3. Giao tiếp: sync vs async
| | Sync (REST/gRPC) | Async (event qua RabbitMQ/Kafka) |
|---|---|---|
| Ngữ nghĩa | Hỏi-đáp, cần kết quả ngay | Thông báo đã xảy ra; người nhận tự xử lý |
| Coupling thời gian | Cao: B chết thì A lỗi | Thấp: B chết, message chờ |
| Độ trễ | Thấp (ms) | Cao hơn, không xác định |
| Độ phức tạp | Timeout, retry, circuit breaker | Idempotency, ordering, dead letter, outbox |
| Dùng khi | Query cần dữ liệu để trả lời user | Side effect, workflow dài, fan-out nhiều người nhận |

- Nguyên tắc: **query sync, command có side effect thì async khi được**. Chuỗi sync A->B->C->D có availability = tích (99,9%^4 ≈ 99,6%) và latency = tổng.
- gRPC trong nội bộ (schema protobuf, streaming, nhanh hơn JSON 5–10×), REST ở biên. Event nên là **fact** ("ScanCompleted") chứ không phải lệnh cho dịch vụ cụ thể ("SendEmail"); schema registry hoặc version trong tên event.

#### 4. Đọc dữ liệu từ nhiều service: API composition vs CQRS view
- **API composition** (BFF/gateway gọi N service rồi ghép): đơn giản, dữ liệu luôn mới; giá: fan-out N request, latency = max, join/filter/phân trang trên nhiều nguồn rất khó ("lọc project có > 10 critical vuln và thuộc team X" cần dữ liệu từ 2 service).
- **CQRS read model**: một service lắng nghe event của nhiều service, dựng bảng đọc đã denormalize đúng hình dạng màn hình; đọc 1 query, phân trang/filter dễ; giá: eventual consistency, phải rebuild view khi logic đổi, thêm một nơi lưu.
- Chọn composition cho màn hình đơn giản, ít nguồn; chọn read model cho danh sách/filter/dashboard.

#### 5. Distributed monolith và cách nhận ra
- Triệu chứng: deploy theo thứ tự bắt buộc; thay đổi một tính năng chạm 3+ repo; service gọi nhau sync thành chuỗi dài; share DB hoặc share thư viện "common model" khiến đổi struct là build lại tất cả; không thể test một service một mình.
- Nguyên nhân thường gặp: tách theo tầng kỹ thuật hoặc theo bảng, không theo nghiệp vụ; tách trước khi hiểu domain.

#### 6. Strangler fig: tách dần, không viết lại
1. Đặt **facade/gateway** trước monolith; mọi traffic đi qua đó.
2. Chọn một bounded context ở **rìa** (ít phụ thuộc, có giá trị rõ: ví dụ notification, export) và xây service mới.
3. Chuyển dần route sang service mới (theo %, theo tenant, feature flag); monolith vẫn chạy phần còn lại.
4. Dữ liệu: giai đoạn đầu service mới đọc/ghi qua API của monolith hoặc đồng bộ bằng CDC; sau đó cắt ownership, xoá code cũ.
5. Lặp lại. Mỗi bước có đường lùi (chuyển route về). Hàng tháng tới năm là bình thường; không có "big bang".

:::diagram
Client[FE / CI] -> GW[Gateway / facade]
GW -> Mono[Monolith apiserver] : 80% route
GW -> Ingest[Ingest service - upload + parse] : /uploads
GW -> Policy[Policy service] : /policies
Ingest -> Bus[Event bus - RabbitMQ]
Bus -> Enrich[Enrichment - Lambda]
Bus -> Policy : ComponentsIngested
Bus -> Notify[Notification service]
Policy -> PolicyDB[(policy DB)]
Ingest -> IngestDB[(ingest DB)]
Mono -> MonoDB[(monolith DB)]
Bus -> ReadModel[Dashboard read model]
GW -> ReadModel : /dashboard
:::

#### 7. Modular monolith: lựa chọn mặc định hợp lý
- Một binary, một DB, nhưng code chia **module theo bounded context** với API nội bộ rõ (Go: package theo domain, chỉ export interface; cấm import chéo bằng lint như [[depguard]]/[[go-arch-lint]]); mỗi module sở hữu bảng của mình (schema prefix hoặc schema riêng trong cùng DB), giao tiếp qua interface hoặc in-process event bus.
- Lợi: transaction đơn giản, refactor an toàn với compiler, deploy một thứ, debug một process; vẫn có thể chạy **nhiều bản của cùng binary với role khác nhau** (api, worker, scheduler) để scale riêng từng phần.
- Khi cần tách thật, module đã có ranh giới -> tách thành service là việc vài tuần, không phải viết lại. Shopify, Stack Overflow, Basecamp chạy monolith ở quy mô lớn.
- Không hợp khi: nhiều ngôn ngữ bắt buộc, yêu cầu compliance tách hạ tầng, hoặc tổ chức > 50 engineer với nhịp release khác hẳn nhau.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Ngưỡng team cân nhắc tách | ~10–15 engineer; dưới đó modular monolith |
| Chi phí một hop nội bộ | +0,5–2 ms latency, thêm một điểm lỗi |
| Chuỗi 4 service 99,9% | ~99,6% availability tổng |
| gRPC vs REST JSON | nhanh hơn 5–10× về serialize, payload nhỏ 3–10× |
| Strangler fig | tính bằng tháng tới năm; mỗi bước có đường lùi |
| Replica tối thiểu mỗi service | 2, cộng sidecar/agent -> chi phí hạ tầng tăng theo N |

### Sai lầm hay gặp
- Tách theo tầng (auth service, db service) hoặc theo bảng (UserService CRUD) thay vì theo nghiệp vụ.
- Hai service dùng chung một DB "tạm thời" rồi mãi mãi; migration của một bên làm bên kia 500.
- Chuỗi sync dài; không có timeout/circuit breaker nên một service chậm kéo cả hệ.
- Dùng event như RPC trá hình ("SendEmailCommand" gửi cho đúng một consumer, chờ phản hồi).
- Thư viện "common" chứa model của mọi domain -> coupling ẩn, mọi service build lại khi đổi một struct.
- Big-bang rewrite thay vì strangler fig; dừng tính năng 6 tháng rồi bản mới chưa bằng bản cũ.
- Chọn microservice để "giải quyết" code bẩn: code bẩn phân tán còn khó hơn code bẩn tập trung.

### Nói thế nào trong phỏng vấn (EN)
- "For a team this size I would start with a modular monolith with strict module boundaries, and extract services only when there is evidence we need to." — Team cỡ này bắt đầu bằng modular monolith, chỉ tách khi có bằng chứng.
- "Service boundaries follow bounded contexts, and each service owns its data; nobody else touches its tables." — Ranh giới theo bounded context, mỗi service sở hữu dữ liệu của mình.
- "Queries are synchronous; side effects go through events so a slow downstream does not block the user." — Query sync, side effect qua event để downstream chậm không chặn người dùng.
- "For list and dashboard screens I would build a read model from events rather than composing five APIs per request." — Màn danh sách/dashboard dùng read model từ event thay vì ghép 5 API.
- "A distributed monolith is when services must deploy together or share a database; that is the outcome I am trying to avoid." — Distributed monolith là khi service phải deploy cùng nhau hoặc share DB.
- "I would migrate with the strangler fig pattern: a facade in front, move one bounded context at a time, always with a rollback path." — Di chuyển bằng strangler fig, một context mỗi lần, luôn có đường lùi.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Hiện có apiserver + worker (bootstrap) + Lambda enrichment + FE, cùng một DB Postgres. Đây gần với "monolith chạy nhiều role" hơn là microservices — và đó không phải điều xấu. Câu hỏi là ranh giới module bên trong có rõ không: parse, enrichment, policy, notification, audit có import chéo nhau không? Chạy [[go list -deps]] hoặc [[go-arch-lint]] để vẽ đồ thị import giữa package domain; vòng lặp import là bằng chứng ranh giới mờ.
- Ranh giới hợp lý theo bounded context: (1) Ingest (upload, parse, component identity), (2) Enrichment (license + vulnerability, phần lớn là dữ liệu dùng chung, không có tenant), (3) Policy evaluation, (4) Notification/Audit, (5) Vulnerability feed sync. Lambda hiện làm (2) — ranh giới đúng vì scale và nhịp khác; nhưng Lambda và worker cùng ghi t_components/PRCL là **share DB giữa hai "service"**: mọi migration (sự cố #5 FDW frozen schema) đều có hai nạn nhân.
- Sự cố #12 (audit publish trước commit) và #1 (publisher singleton) là vấn đề ở cạnh async: chuẩn hoá một outbox table trong apiserver cho mọi event; relay riêng publish. Một chỗ sửa thay vì mỗi module tự publish.
- Dashboard distribution đọc snapshot t_project_metrics là một read model thủ công; đặt tên và sở hữu nó rõ ràng (module Reporting), cập nhật từ event ScanCompleted/EnrichmentCompleted thay vì đuôi của upload chain (nguyên nhân distribution thiếu khi chain gãy).
- Đừng đề xuất tách microservice trong năm nay: team nhỏ, một DB, ops bằng docker-compose + Watchtower. Đề xuất ngược lại: modular monolith có lint ranh giới + outbox + read model rõ; viết ADR "Vì sao chưa tách service" với tiêu chí kích hoạt (ví dụ: enrichment cần > 3 ngôn ngữ, hoặc policy eval cần scale 10× API).
- Nếu phải tách một thứ đầu tiên: Notification (rìa, ít phụ thuộc, có giá trị khi lên realtime ở bài B20) theo strangler fig qua gateway hiện có.
- Cạnh sync nguy hiểm nhất hiện có: apiserver gọi thẳng Lambda (direct invoke) hoặc FDW join sang DB vulnerability trong request người dùng — một downstream chậm kéo p99 API. Chuyển những cạnh này sang async (event) hoặc read model đã materialize trong DB tenant; giữ sync chỉ cho query thật sự cần dữ liệu tức thì.
- Việc tuần này: vẽ đồ thị import package, liệt kê bảng nào được ghi bởi > 1 process (apiserver/worker/Lambda), đề xuất owner cho từng bảng.
`,
  quiz: [
    { t: 'mc', q: 'Dấu hiệu rõ nhất của một distributed monolith là gì?', o: ['Các service phải deploy theo thứ tự hoặc share database, một tính năng chạm nhiều repo', 'Mỗi service có repo riêng', 'Dùng gRPC thay vì REST', 'Có nhiều hơn 5 service'], a: 0, why: 'Coupling thời gian và coupling schema làm mất lợi ích độc lập trong khi vẫn trả giá phân tán.' },
    { t: 'mc', q: 'Vì sao database-per-service được coi là nguyên tắc chứ không phải tuỳ chọn?', o: ['Vì mỗi DB engine chỉ hỗ trợ một service', 'Vì share bảng tạo coupling ở schema: đổi cột làm vỡ service khác, không scale/migrate độc lập được', 'Vì transaction phân tán nhanh hơn transaction cục bộ', 'Vì giảm chi phí hạ tầng'], a: 1, why: 'Dữ liệu cần ở hai nơi thì replicate qua event, chấp nhận eventual consistency.' },
    { t: 'mc', q: 'Chuỗi gọi sync A -> B -> C -> D, mỗi service 99,9% availability. Availability tổng xấp xỉ bao nhiêu?', o: ['99,9%', '96%', '99,99%', '99,6%'], a: 3, why: '0,999^4 ≈ 0,996; latency là tổng các hop. Đây là lý do hạn chế chuỗi sync dài.' },
    { t: 'mc', q: 'Màn hình danh sách project cần lọc theo số vulnerability critical (service Enrichment) và team sở hữu (service Identity), có phân trang. Cách tiếp cận hợp lý?', o: ['API composition: gateway gọi hai service rồi ghép và lọc trong RAM', 'Cho FE gọi trực tiếp hai service rồi ghép', 'CQRS read model: một bảng đọc denormalize dựng từ event của hai service, query và phân trang trên đó', 'Để hai service dùng chung bảng project'], a: 2, why: 'Filter + phân trang xuyên nguồn là điểm yếu của composition; read model trả bằng một query, đổi lấy eventual consistency.' },
    { t: 'mc', q: 'Bước đầu tiên của strangler fig migration là gì?', o: ['Đặt facade/gateway trước monolith để điều hướng được từng route', 'Viết lại module lớn nhất trước để thấy hiệu quả', 'Tách database thành nhiều DB ngay', 'Dừng phát triển tính năng mới trong 6 tháng'], a: 0, why: 'Facade cho phép chuyển từng bounded context ở rìa sang service mới theo % hoặc theo tenant, luôn có đường lùi.' },
    { t: 'fill', q: 'Điền: trong DDD, vùng mà một thuật ngữ nghiệp vụ có đúng một nghĩa, dùng làm cơ sở vẽ ranh giới service, gọi là ___ context.', a: ['bounded', 'bounded context'], why: 'Ranh giới theo nghiệp vụ, không theo tầng kỹ thuật hay theo bảng.' },
    { t: 'fill', q: 'Điền: kiến trúc một binary, một DB nhưng code chia module theo domain với ranh giới nghiêm ngặt (lint cấm import chéo) gọi là ___ monolith.', a: ['modular', 'modular monolith'], why: 'Lựa chọn mặc định hợp lý cho team dưới 10–15 người; tách service sau nếu có bằng chứng.' },
    { t: 'open', q: 'Interviewer: "Your team of eight maintains a Go monolith with an API server and background workers. Would you move to microservices? Why or why not?" Trả lời 4–6 câu.', a: 'Không, chưa có bằng chứng: team 8 người, một DB, một nhịp release; tách sẽ trả giá về mạng, consistency, debug và ops mà không nhận lợi ích deploy độc lập. Tôi sẽ củng cố modular monolith: chia package theo bounded context (ingest, enrichment, policy, notification), lint cấm import chéo, mỗi module sở hữu bảng của mình, giao tiếp qua interface và outbox event. Chạy cùng binary với role khác nhau để scale API và worker riêng. Đặt tiêu chí kích hoạt tách trong ADR, ví dụ một module cần scale 10 lần hoặc ngôn ngữ khác, và khi đó dùng strangler fig cho module ở rìa như notification trước.', keys: ['modular monolith', 'bounded context', 'ownership', 'strangler', 'evidence'] }
  ]
},
{ id: 'B17', type: 'block', topic: 'scale', title: 'Resilience chuyên sâu: timeout hierarchy, retry budget, circuit breaker, bulkhead, load shedding, backpressure, graceful shutdown, chaos', time: '130 phút',
  goal: 'Thiết kế được bộ cơ chế chịu lỗi có thông số cụ thể (timeout lồng nhau, retry budget, circuit breaker, bulkhead, load shedding, backpressure, graceful shutdown) cho một dịch vụ Go, và giải thích vì sao từng cơ chế ngăn một lỗi nhỏ lan thành sự cố toàn hệ.',
  md: `
### Vấn đề cần giải
- Lỗi trong hệ phân tán hiếm khi là "một thứ chết"; nó là **lan truyền**: một dependency chậm làm hết connection pool, pool hết làm request xếp hàng, client timeout rồi retry, retry nhân đôi tải, dịch vụ đang khó thở bị đè chết hẳn (**retry storm**, **cascading failure**).
- Hệ thống của bạn đã gặp đủ dạng: một coordinate xấu làm hỏng cả batch gọi API ngoài và FetchBatch nuốt lỗi (sự cố #7); sweeper lấy 100 dòng cũ nhất bị zombie chiếm chỗ, query 54–489 s ăn hết budget 60 s nên xử lý 0 dòng (sự cố #8); Watchtower redeploy giết tiến trình giữa chừng làm lịch lỡ tick (sự cố #9); statement_timeout 90 s ở cấp role giết query dài mà code không biết (sự cố #4).
- Resilience không phải một thư viện bật lên; là **tập thông số có chủ đích** ở mọi ranh giới: chờ bao lâu, thử lại bao nhiêu, khi nào ngừng thử, bỏ ai trước, và chết thế nào cho sạch.

### Cốt lõi
#### 1. Timeout hierarchy và deadline propagation
- Quy tắc: timeout **giảm dần theo chiều sâu**: client (30 s) > gateway (25 s) > service (20 s) > từng call DB/HTTP (2–5 s). Nếu tầng trong chờ lâu hơn tầng ngoài, tầng ngoài đã bỏ đi mà tầng trong vẫn làm việc vô ích (**wasted work**) và giữ tài nguyên.
- **Deadline propagation**: truyền thời hạn còn lại thay vì timeout cố định. Go: [[ctx, cancel := context.WithTimeout(parent, d)]]; mọi call nhận [[ctx]]; gRPC tự truyền deadline qua header [[grpc-timeout]]; HTTP truyền bằng header tự định nghĩa rồi [[context.WithDeadline]] ở bên nhận.
- Luôn đặt timeout ở **mọi** I/O: [[http.Client{Timeout}]] (mặc định là vô hạn), [[pgx]] qua ctx, Redis [[ReadTimeout]], RabbitMQ publish confirm. DB: [[statement_timeout]] đặt theo **session/transaction** từ ứng dụng, không đặt ở role chung (sự cố #4) — báo cáo dài cần timeout khác với API ngắn.
- Timeout bao nhiêu? Đo p99 của dependency lúc khoẻ, lấy ×2–3; không lấy "30 giây cho chắc".

#### 2. Retry đúng cách và retry budget
- Chỉ retry lỗi **tạm thời** (timeout, 503, connection reset, deadlock), không retry 4xx hay lỗi nghiệp vụ. Thao tác phải **idempotent** hoặc có idempotency key.
- **Exponential backoff + full jitter**: [[sleep = rand(0, min(cap, base × 2^attempt))]]; base 100 ms, cap 10–30 s, tối đa 3 lần. Jitter phá đồng bộ: không có jitter, 1000 client cùng retry đúng một thời điểm.
- **Retry budget** (Google SRE, Finagle): tổng retry ≤ 10% tổng request trong cửa sổ trượt; vượt thì không retry nữa. Retry theo "3 lần mỗi request" có thể nhân tải ×4 khi downstream đang hấp hối — đúng lúc tệ nhất. Budget giữ tải tối đa +10%.
- **Hedged request**: gửi bản sao sau khi chờ quá p95 (không chờ timeout), lấy kết quả về trước, huỷ cái còn lại. Cắt đuôi latency cho read idempotent; giá: +5% tải. Không dùng cho write.
- Retry ở **một tầng** thôi (thường tầng gần người gọi nhất hiểu ngữ nghĩa); retry lồng 3 tầng × 3 lần = 27 lần gọi DB.

#### 3. Circuit breaker
- Trạng thái: **Closed** (bình thường, đếm lỗi) -> **Open** khi lỗi vượt ngưỡng (ví dụ ≥ 50% lỗi trên tối thiểu 20 request trong 10 s) -> fail-fast ngay lập tức không gọi downstream, trong **open duration** (5–30 s) -> **Half-open**: cho qua 1–vài probe; thành công thì Closed, thất bại thì Open lại.
- Mục đích: (1) bảo vệ downstream đang yếu khỏi bị đè, (2) trả lỗi nhanh (ms) thay vì treo tới timeout, giải phóng thread/pool của chính mình, (3) có chỗ gắn **fallback** (cache cũ, giá trị mặc định, degrade tính năng).
- Một breaker **per dependency per host/endpoint**, không một breaker cho toàn bộ "HTTP". Go: [[sony/gobreaker]], [[failsafe-go]]. Đo state breaker bằng metric; breaker mở là alert.
- Khi KHÔNG dùng: dependency là DB chính duy nhất (mở breaker = chết toàn bộ; thay bằng load shedding), hoặc lưu lượng quá thấp để thống kê có nghĩa.

#### 4. Bulkhead
- Vách ngăn tàu: chia tài nguyên theo dependency/tenant/loại công việc để một thứ ngập không ngập hết. Thực tế: **pool kết nối riêng** cho từng downstream (HTTP client riêng cho ClearlyDefined, OSV, NVD), **worker pool riêng** cho job nặng và job nhẹ, **semaphore** giới hạn concurrency mỗi tenant.
- Không có bulkhead: ClearlyDefined chậm 30 s chiếm hết 100 goroutine worker; OSV và NVD khoẻ nhưng không còn ai gọi.
- Giá: tài nguyên không chia sẻ nên tổng cần nhiều hơn; cấu hình thêm. Kích thước pool = (RPS mục tiêu × latency p99) + dự phòng (Little's law).

#### 5. Load shedding và ưu tiên
- Khi tải vượt khả năng, **từ chối sớm một phần** để phần còn lại đạt SLO, thay vì tất cả chậm đến mức ai cũng timeout (goodput sụp về 0).
- Tín hiệu: độ sâu hàng đợi, số request đang xử lý (inflight) vượt ngưỡng, thời gian chờ trong queue (**CoDel**: nếu request đã đợi > 5 ms liên tục trong 100 ms, bắt đầu drop), CPU/pool bão hoà. Trả [[429]]/[[503]] + [[Retry-After]] ngay, chi phí vài µs.
- **Ưu tiên**: giữ request người dùng tương tác, bỏ batch/report/scheduled trước; giữ tenant trả phí cao hơn trước tenant free. Gắn **criticality** vào request (header) và truyền xuống.
- Khác với rate limit: rate limit là hạn mức theo thoả thuận (per client), shedding là phản ứng theo sức khoẻ hiện tại (toàn hệ).

#### 6. Backpressure end-to-end
- Nguyên tắc: **producer không được nhanh hơn consumer chậm nhất mà không có chỗ chứa hữu hạn**. Chỗ chứa vô hạn (unbounded channel, queue không giới hạn, slice [] gom hết rồi xử lý) = OOM trễ.
- Công cụ: bounded channel trong Go (gửi block khi đầy = tín hiệu ngược tự nhiên), RabbitMQ **prefetch** (consumer chỉ nhận N message chưa ack), TCP flow control, HTTP 429, Kafka consumer tự kéo theo tốc độ xử lý, [[errgroup.SetLimit]].
- Sự cố #8: sweeper lấy "100 pending cũ nhất" là hàng đợi FIFO không có cơ chế loại phần tử hỏng -> zombie chiếm chỗ mãi (**head-of-line blocking**). Fix: retry count + backoff per dòng, chuyển sang trạng thái dead sau N lần, lấy theo [[next_attempt_at]] thay vì [[created_at]]; và query chọn việc phải nhanh (partial index) vì nó nằm trong vòng lặp có budget.
- Sự cố #7: một phần tử xấu làm hỏng cả batch -> **isolate failure per item**: batch API lỗi thì chia đôi và thử lại (bisect) hoặc fallback gọi từng item; kết quả **partial success** phải được ghi nhận từng dòng, không được nuốt lỗi và đánh dấu cả batch failed hay — tệ hơn — không đánh dấu gì.

:::diagram
Client[FE / CI] -> GW[Gateway - timeout 25s, shed 503] : timeout 30s
GW -> API[apiserver - ctx deadline 20s]
API -> CB_DB[Breaker/Pool DB] : stmt timeout 5s
CB_DB -> DB[Postgres]
API -> MQ[RabbitMQ - bounded queue]
MQ -> Worker[Worker - prefetch 10, pool per dep] : backpressure
Worker -> CB_CD[Bulkhead + breaker CD] : per-item isolate
Worker -> CB_OSV[Bulkhead + breaker OSV]
CB_CD -> CD[ClearlyDefined]
CB_OSV -> OSV[OSV / NVD]
Worker -> DLQ[Dead letter / dead rows] : after N retries
Deploy[SIGTERM Watchtower] -> Worker : drain 30s
:::

#### 7. Graceful shutdown
- Nhận [[SIGTERM]] -> (1) báo "không khoẻ" cho LB/readiness để ngừng nhận request mới, (2) ngừng nhận message mới (huỷ consumer, không ack thêm), (3) chờ in-flight hoàn tất với deadline (10–30 s, phải nhỏ hơn grace period của orchestrator: Docker mặc định 10 s, K8s 30 s), (4) đóng pool, flush log/metric, exit 0.
- Go: [[signal.NotifyContext]] + [[http.Server.Shutdown(ctx)]]; worker: đóng channel nhận việc, [[wg.Wait()]] với timeout; job dở dang phải idempotent để chạy lại không hỏng.
- Sự cố #9: Watchtower redeploy giết tiến trình trong 30 s mà lịch gocron chỉ sống trong RAM -> tick bị lỡ. Graceful shutdown không cứu được lịch; cần **persist lịch** (bảng schedule với next_run_at) + **leader election** (Redis lock/Postgres advisory lock) + job **catch-up** khi khởi động ("tick nào đáng lẽ chạy mà chưa chạy?").

#### 8. Thundering herd, retry storm, và chaos
- **Thundering herd**: cache hết hạn đồng loạt, mọi client cùng reconnect sau khi broker sống lại, cron chạy đúng 00:00. Chống: jitter ở mọi lịch và TTL, single-flight (một goroutine đi lấy, còn lại chờ), reconnect với backoff + jitter.
- **Chaos engineering**: thử nghiệm có kiểm soát (giết một container, chèn độ trễ 2 s vào ClearlyDefined, drop 10% gói, hết đĩa) với giả thuyết đo được ("alert nổ trong 5 phút, error rate < 1%"). Bắt đầu ở staging, có nút dừng, phạm vi nhỏ (blast radius). **Game day**: cả team diễn tập sự cố theo kịch bản, chấm runbook.
- Sự cố #1 nếu có game day "recreate RabbitMQ container" đã lộ ngay trong 10 phút thay vì nhiều ngày.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Timeout per call | p99 lúc khoẻ × 2–3; giảm dần theo chiều sâu |
| Retry | tối đa 3, backoff base 100 ms, cap 10–30 s, full jitter |
| Retry budget | ≤ 10% tổng request |
| Hedged request | gửi bản sao sau p95, chỉ cho read idempotent, +~5% tải |
| Circuit breaker | mở khi ≥ 50% lỗi / ≥ 20 request / 10 s; open 5–30 s; half-open 1–vài probe |
| CoDel | target 5 ms chờ queue, interval 100 ms |
| Graceful shutdown | drain ≤ grace period (Docker 10 s mặc định, K8s 30 s) |
| Pool size | RPS × latency p99 + dự phòng (Little's law) |

### Sai lầm hay gặp
- [[http.Client{}]] mặc định không timeout; một dependency treo giữ goroutine mãi.
- Timeout tầng trong dài hơn tầng ngoài; hoặc timeout DB đặt ở role chung thay vì theo loại query.
- Retry không jitter, retry ở nhiều tầng, retry cả lỗi 4xx/nghiệp vụ, retry thao tác không idempotent.
- Một circuit breaker toàn cục cho mọi HTTP call; hoặc breaker cho DB chính rồi tự tay tắt hệ thống.
- Hàng đợi/unbounded channel "cho an toàn" -> OOM lúc traffic đỉnh; gom toàn bộ kết quả vào slice rồi mới xử lý.
- Nuốt lỗi batch: [[if err != nil { continue }]] mà không ghi trạng thái từng item -> hàng nghìn dòng failed vĩnh viễn hoặc pending mãi.
- Hàng đợi FIFO không có retry count/backoff -> zombie chặn đầu hàng.
- Shutdown bằng [[os.Exit]] ngay khi nhận SIGTERM; job đang chạy nửa chừng, message chưa ack bị redeliver trùng.
- Chỉ test resilience bằng unit test; chưa bao giờ giết container ở staging.

### Nói thế nào trong phỏng vấn (EN)
- "Timeouts must shrink as you go deeper, and the remaining deadline is propagated through the context so inner calls never outlive the caller." — Timeout giảm dần theo chiều sâu, deadline truyền qua context.
- "I retry only transient errors, with exponential backoff and full jitter, and cap retries at about 10 percent of traffic with a retry budget." — Chỉ retry lỗi tạm thời, backoff + jitter, retry budget 10%.
- "A circuit breaker per dependency fails fast when the error rate crosses a threshold and probes in half-open state before closing." — Breaker per dependency, fail fast, probe ở half-open.
- "Bulkheads give each dependency its own pool so one slow API cannot starve the others." — Bulkhead cho mỗi dependency pool riêng.
- "Under overload I shed low-priority requests early with a 503 so the rest still meet the SLO; it is better than everyone timing out." — Quá tải thì bỏ sớm request ưu tiên thấp để phần còn lại đạt SLO.
- "Backpressure needs bounded buffers end to end; an unbounded queue just turns overload into an out-of-memory crash later." — Backpressure cần buffer hữu hạn; queue vô hạn chỉ biến quá tải thành OOM.
- "On SIGTERM the service stops accepting work, drains in-flight requests within the grace period, and exits cleanly." — Nhận SIGTERM thì ngừng nhận việc, drain in-flight trong grace period.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #7: sửa FetchBatch gọi ClearlyDefined theo nguyên tắc isolate per item: batch lỗi -> bisect (chia đôi gọi lại) tới khi cô lập được coordinate hỏng, ghi trạng thái failed kèm lý do cho đúng dòng đó, các dòng còn lại succeeded. Tuyệt đối không [[return err]] cho cả batch mà không ghi gì. Thêm metric [[enrichment_items_total{result, reason}]].
- Sự cố #8: đổi sweeper từ "100 pending cũ nhất" sang [[WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 100]] với [[attempts]] và backoff theo cấp số nhân; sau 5 lần chuyển [[dead]] để người xem. Partial index trên (status, next_attempt_at) đã chứng minh hiệu quả (sự cố #16, phút -> ms); đưa vào migration chính thức thay vì chỉ tạo tay trên Canary.
- Sự cố #4: xoá statement_timeout ở role; thay bằng [[SET LOCAL statement_timeout]] theo loại công việc: API 5 s, export/report 5 phút, migration không giới hạn. Mọi [[pgx]] call nhận ctx có deadline từ request.
- Bulkhead trong worker: HTTP client riêng (timeout, MaxConnsPerHost) cho ClearlyDefined, OSV, NVD, GHSA, EUVD, JVNDB; semaphore per nguồn; breaker per nguồn với metric state. Một nguồn chết không làm pending của nguồn khác dồn.
- Backpressure: RabbitMQ consumer prefetch = số goroutine xử lý (ví dụ 10), không dùng unbounded channel; Lambda invoke có concurrency limit; worker [[errgroup.SetLimit(10)]] thay vì go cho mọi project (sự cố #3 OOM cũng là thiếu backpressure về bộ nhớ).
- Graceful shutdown cho worker và apiserver: [[signal.NotifyContext]], ngừng consume, chờ in-flight ≤ 25 s; Watchtower đặt [[WATCHTOWER_TIMEOUT]] ≥ 30 s. Cho gocron: persist next_run_at vào Postgres, advisory lock làm leader, catch-up tick bị lỡ khi khởi động (sự cố #9).
- Retry publish RabbitMQ với reconnect + backoff + jitter, và alert "no success" (bài B14) để sự cố #1 không lặp lại trong im lặng.
- Game day đầu tiên (1 giờ, staging): recreate container rabbitmq, chèn độ trễ 5 s vào ClearlyDefined bằng toxiproxy, giết worker giữa batch. Ghi lại: alert có nổ không, dữ liệu có nhất quán không, runbook có dùng được không.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao timeout ở tầng trong (DB call) phải ngắn hơn timeout ở tầng ngoài (client)?', o: ['Vì DB luôn nhanh hơn mạng', 'Vì Go không cho phép timeout lồng nhau', 'Vì nếu tầng trong chờ lâu hơn, tầng ngoài đã bỏ đi mà tầng trong vẫn làm việc vô ích và giữ tài nguyên', 'Vì load balancer yêu cầu như vậy'], a: 2, why: 'Timeout giảm dần theo chiều sâu và truyền deadline còn lại qua context để tránh wasted work.' },
    { t: 'mc', q: 'Retry budget giải quyết vấn đề gì mà retry "tối đa 3 lần mỗi request" không giải quyết được?', o: ['Retry budget giúp retry nhanh hơn', 'Retry budget thay thế cho backoff', 'Retry budget cho phép retry lỗi 4xx', 'Khi downstream đang hấp hối, retry per-request nhân tải lên nhiều lần đúng lúc tệ nhất; budget giới hạn tổng retry ở ~10% traffic'], a: 3, why: 'Budget là giới hạn toàn cục theo cửa sổ trượt, chặn retry storm; backoff + jitter vẫn cần.' },
    { t: 'mc', q: 'Circuit breaker ở trạng thái half-open làm gì?', o: ['Từ chối toàn bộ request', 'Cho qua một hoặc vài request thăm dò; thành công thì đóng lại, thất bại thì mở tiếp', 'Chuyển request sang fallback vĩnh viễn', 'Giảm timeout xuống một nửa'], a: 1, why: 'Half-open là cơ chế tự phục hồi có kiểm soát sau open duration.' },
    { t: 'mc', q: 'Sweeper lấy "100 dòng pending cũ nhất" mỗi vòng; vài trăm dòng lỗi vĩnh viễn luôn nằm đầu danh sách. Hiện tượng và cách sửa?', o: ['Head-of-line blocking/zombie starvation; sửa bằng attempts + backoff per dòng, lấy theo next_attempt_at, chuyển dead sau N lần', 'Thundering herd; sửa bằng jitter', 'Cache stampede; sửa bằng single-flight', 'Split-brain; sửa bằng leader election'], a: 0, why: 'FIFO không có cơ chế loại phần tử hỏng thì phần tử hỏng chiếm chỗ mãi; đồng thời query chọn việc phải nhanh để không ăn hết budget.' },
    { t: 'mc', q: 'Load shedding khác rate limiting ở điểm nào?', o: ['Load shedding áp dụng cho DB, rate limit cho API', 'Load shedding trả 200, rate limit trả 429', 'Rate limit là hạn mức theo thoả thuận per client; load shedding là phản ứng theo sức khoẻ hiện tại của hệ, bỏ request ưu tiên thấp để phần còn lại đạt SLO', 'Không khác nhau'], a: 2, why: 'Shedding dựa vào tín hiệu như queue wait (CoDel), inflight, CPU; ưu tiên theo criticality.' },
    { t: 'fill', q: 'Điền: mẫu chia tài nguyên (pool kết nối, worker) riêng cho từng dependency để một dependency chậm không chiếm hết tài nguyên của các dependency khác gọi là ___.', a: ['bulkhead', 'bulkhead pattern'], why: 'Lấy tên từ vách ngăn khoang tàu; kích thước pool theo Little’s law.' },
    { t: 'fill', q: 'Điền: kỹ thuật gửi một bản sao request sau khi chờ quá p95 (không chờ timeout) rồi lấy kết quả về trước, dùng cho read idempotent để cắt đuôi latency, gọi là ___ request.', a: ['hedged', 'hedged request', 'hedging'], why: 'Tăng ~5% tải, không dùng cho write.' },
    { t: 'open', q: 'Interviewer: "One slow third-party API recently took down your whole background processing. Walk me through how you would redesign the worker." Trả lời 4–6 câu.', a: 'Đặt timeout rõ cho mỗi call theo p99 lúc khoẻ và truyền deadline qua context. Bulkhead: HTTP client, semaphore và breaker riêng cho từng nguồn để nguồn chậm không chiếm hết goroutine. Retry chỉ lỗi tạm thời với backoff + jitter trong retry budget 10%, và xử lý lỗi theo từng item (bisect batch) để một item xấu không làm hỏng cả batch, ghi trạng thái partial success. Backpressure bằng prefetch và bounded concurrency, hàng đợi có attempts/next_attempt_at và trạng thái dead thay vì FIFO. Thêm metric state breaker, alert no-success, graceful shutdown, và một game day chèn độ trễ vào API đó ở staging để chứng minh.', keys: ['timeout', 'bulkhead', 'circuit breaker', 'retry budget', 'per item'] }
  ]
},
{ id: 'B18', type: 'block', topic: 'cloud', title: 'Triển khai và vận hành: rolling/blue-green/canary, feature flag, schema migration expand-contract, container/K8s cơ bản, serverless trade-off, IaC', time: '130 phút',
  goal: 'Chọn chiến lược deploy phù hợp với rủi ro và chi phí, viết được kế hoạch schema migration không downtime theo expand-contract, nêu đúng các khái niệm K8s/serverless cần cho phỏng vấn, và nhận diện các lỗi vận hành (config drift, image không pin, không có memory limit) từ sự cố thật.',
  md: `
### Vấn đề cần giải
- Phần lớn sự cố production không đến từ traffic mà từ **thay đổi**: deploy code mới, migration, đổi config, kéo image mới. Nhìn lại sự cố của bạn: Watchtower kéo [[mongo:latest]] làm crash vì kernel host cũ (#13); Lambda mất env sau redeploy (#2); FE image bake [[localhost]] -> 500 toàn site (#10); migration thêm cột làm FDW trả "column does not exist" (#5); container không có memory limit nên OOM không hiện (#3). Năm sự cố, không sự cố nào do người dùng.
- Vì vậy vận hành cần ba câu trả lời trước mỗi thay đổi: **lan ra bao nhiêu** (blast radius), **phát hiện lỗi bằng gì**, và **lùi lại thế nào trong bao lâu**.

### Cốt lõi
#### 1. Chiến lược deploy
| Chiến lược | Cách làm | Downtime | Rollback | Chi phí | Hợp khi |
|---|---|---|---|---|---|
| Recreate | Tắt hết, bật bản mới | Có (giây–phút) | Deploy lại bản cũ | Thấp nhất | Dev/staging, batch nội bộ |
| Rolling | Thay dần từng replica | Không (nếu N-1 tương thích) | Chậm, phải roll ngược từng cái | Thấp | Mặc định của K8s/compose scale |
| Blue-green | Hai môi trường đủ, chuyển LB | Không | Tức thì (chuyển LB về) | Gấp đôi tài nguyên lúc deploy | Cần rollback nhanh, DB tương thích hai chiều |
| Canary | Bản mới nhận 1% -> 10% -> 50% -> 100% | Không | Nhanh, blast radius nhỏ | Trung bình, cần metric so sánh | Dịch vụ có traffic đủ để thống kê |

- **Canary analysis**: so sánh error rate, p99, saturation giữa canary và baseline cùng kích thước trong 10–30 phút mỗi bước; tự động rollback nếu chênh vượt ngưỡng (Argo Rollouts, Flagger). Canary theo **tenant** (tenant nội bộ trước) là lựa chọn hay cho SaaS B2B ít traffic.
- Rolling và canary đều đòi hỏi **N và N-1 chạy song song** được: API tương thích, schema tương thích, message format tương thích. Đây là ràng buộc thiết kế, không phải chi tiết ops.
- Rollback phải được **diễn tập**: một nút bấm hoặc một lệnh, dưới 5 phút, không cần người viết code có mặt.

#### 2. Feature flag và kill switch
- Tách **deploy** (đưa code lên) khỏi **release** (bật cho người dùng). Flag theo tenant/user/%; bật dần, tắt ngay khi có lỗi mà không cần deploy lại (**kill switch**).
- Flag là code có hạn sử dụng: ghi ngày hết hạn, xoá sau khi 100%; vài chục flag sống mãi tạo tổ hợp không test nổi. Cấu hình flag đọc từ store (Redis/DB/LaunchDarkly/Unleash) với cache local và giá trị mặc định an toàn khi store chết.
- Dùng flag cho: logic mới có rủi ro (thuật toán policy mới chạy **shadow** song song, so kết quả, chưa hiển thị), tính năng đắt (realtime notification) bật cho tenant trả phí trước.

#### 3. Schema migration không downtime: expand -> migrate -> contract
1. **Expand**: thêm cột/bảng mới **nullable** hoặc có default (Postgres 11+ default hằng không rewrite bảng); code bản N vẫn chạy vì không biết cột mới.
2. **Dual-write / backfill**: deploy code ghi cả cột cũ và mới, đọc cột cũ; chạy backfill theo lô (10k dòng/lô, sleep giữa lô) cho dữ liệu cũ.
3. **Switch read**: đọc cột mới (flag), xác minh.
4. **Contract**: bỏ ghi cột cũ, sau vài ngày DROP cột cũ. Mỗi bước là một deploy riêng, mỗi bước lùi được.
- Những thứ **lock bảng** phải tránh trên bảng lớn: [[ALTER TABLE ... TYPE]] (rewrite), [[ADD COLUMN ... DEFAULT <hàm volatile>]], [[CREATE INDEX]] thường (chặn ghi) -> dùng [[CREATE INDEX CONCURRENTLY]] (không chạy trong transaction, có thể để lại index INVALID phải kiểm tra), [[ADD CONSTRAINT ... NOT VALID]] rồi [[VALIDATE CONSTRAINT]] riêng; đặt [[lock_timeout]] 5 s cho migration để không xếp hàng chặn mọi query phía sau.
- **Backward compatible N-1**: rename cột là hai bước (thêm mới, xoá cũ), không bao giờ một bước. ORM select * làm bản cũ vỡ khi thêm cột kiểu lạ — select cột tường minh.
- **Dependent schema**: view, materialized view, **FDW foreign table** (sự cố #5), ETL, read replica logic, search index mapping — tất cả giữ bản sao schema riêng. Migration phải có bước "refresh dependents": [[IMPORT FOREIGN SCHEMA ... LIMIT TO]] lại hoặc [[ALTER FOREIGN TABLE ADD COLUMN]], và test tích hợp qua đường FDW. Checklist migration cần dòng "ai còn đọc bảng này ngoài ứng dụng?".

:::diagram
Dev[Git push] -> CI[CI - test + build image]
CI -> Reg[Registry - image@sha256 digest]
Reg -> CD[CD - Argo / GitOps]
CD -> Mig[Migration job - expand only]
Mig -> DB[(Postgres + dependents - FDW, MV)]
CD -> Canary[Canary 10% - new image]
Canary -> Metrics[Metrics - error, p99 vs baseline]
Metrics -> CD : promote or rollback
CD -> Prod[Rolling 100%]
Prod -> Flags[Feature flags / kill switch]
Secrets[SSM / Vault] -> Prod : env at start
IaC[Terraform / compose in git] -> CD : desired state
:::

#### 4. Cấu hình và image
- **Config qua env/ConfigMap, secret qua secret store**, **không bake vào image**: một image chạy mọi môi trường. FE Next.js: biến [[NEXT_PUBLIC_*]] bị **bake lúc build** — đổi env runtime vô dụng (sự cố #10); dùng runtime config endpoint hoặc build riêng mỗi môi trường và nhận thức rõ điều đó.
- Fail fast khi thiếu biến bắt buộc (sự cố #2); in ra (không in giá trị secret) bảng config đã nạp lúc khởi động để log chứng minh môi trường đúng.
- **Pin image**: tag cụ thể ([[mongo:8.2.12]]) hoặc tốt hơn là **digest** ([[image@sha256:...]]); [[latest]] là "bất kỳ thứ gì vào bất kỳ lúc nào" (sự cố #13). Watchtower/auto-update chỉ cho image bạn build và đã test, không cho dependency hạ tầng (DB, broker, cache).
- Image nhỏ (distroless/alpine, multi-stage build), chạy non-root, scan vulnerability (chính sản phẩm SBOM của bạn), ký image (cosign) và verify trước khi chạy.

#### 5. Kubernetes: đủ để phỏng vấn
| Đối tượng | Vai trò |
|---|---|
| Pod | Đơn vị chạy: 1+ container cùng network/volume |
| Deployment | Quản lý ReplicaSet, rolling update, rollback theo revision |
| Service | IP/DNS ổn định + load balance tới pod theo label |
| Ingress / Gateway | HTTP routing từ ngoài vào Service |
| ConfigMap / Secret | Config và secret mount vào pod |
| HPA | Tự scale số pod theo CPU/memory/custom metric |
| PDB | PodDisruptionBudget: tối thiểu N pod sống khi node drain |
| Probes | liveness (restart khi treo), readiness (nhận traffic khi sẵn sàng), startup |

- **requests/limits**: requests dùng để xếp lịch (scheduler), limits là trần. Không có memory limit -> container ăn hết node, OOM không có dấu vết trong inspect (sự cố #3). Quy tắc: luôn đặt memory limit (= requests để tránh bị giết tuỳ tiện, class Guaranteed); CPU limit có thể bỏ (throttling) nhưng requests phải có.
- Docker compose cũng có [[deploy.resources.limits]] / [[mem_limit]]; không cần K8s để có giới hạn.
- Khi KHÔNG dùng K8s: team < 5 người ops, vài chục container, một vài máy — compose + systemd + runbook rẻ hơn nhiều so với vận hành control plane; cân nhắc managed (EKS/GKE) hoặc ECS/Nomad trước.

#### 6. Serverless (Lambda): trade-off
- Lợi: không quản lý máy, scale theo request về 0, trả theo ms; hợp cho tải **bursty**, event-driven (xử lý file upload, enrichment batch), glue code.
- Giới hạn: **cold start** (Go 100–300 ms, JVM giây; dùng provisioned concurrency có phí), **timeout tối đa 15 phút**, payload 6 MB sync, /tmp 10 GB, **concurrency** theo account (mặc định 1000) và reserved per function; kết nối DB phải qua pool ngoài (RDS Proxy) vì mỗi instance mở pool riêng.
- **Config drift**: env Lambda sống trong console nếu không IaC — redeploy từ pipeline khác ghi đè mất biến (sự cố #2). Lambda phải do Terraform/SAM quản lý toàn bộ, không sửa tay.
- Khi KHÔNG dùng: job dài > 15 phút (chia nhỏ hoặc dùng container/Step Functions), latency ổn định < 50 ms yêu cầu nghiêm, tải đều và cao (EC2/container rẻ hơn 3–5 lần), cần kết nối dài (WebSocket, consumer RabbitMQ — Lambda không consume AMQP tự nhiên, phải có bridge).

#### 7. IaC, GitOps, runbook
- **Terraform/Pulumi/CloudFormation**: hạ tầng là code, review qua PR, [[plan]] trước [[apply]], state lưu remote có lock. Mọi thứ không trong code là drift chờ nổ.
- **GitOps** (Argo CD/Flux): trạng thái mong muốn trong git, controller đồng bộ cluster về đúng git; rollback = revert commit. Compose + Watchtower là GitOps "thủ công" thiếu phần quan trọng nhất: so sánh desired vs actual.
- **Runbook & rollback plan** trong mỗi PR có rủi ro: bước deploy, dấu hiệu thành công (metric nào), dấu hiệu thất bại, lệnh rollback, người liên hệ. Postmortem không đổ lỗi sau mỗi sự cố, có action item có chủ và hạn.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Canary step | 1% -> 10% -> 50% -> 100%, mỗi bước 10–30 phút |
| Rollback mục tiêu | < 5 phút, một lệnh |
| lock_timeout cho migration | ~5 s; backfill theo lô 10k dòng |
| Lambda | timeout tối đa 15 phút, payload sync 6 MB, concurrency mặc định 1000/account, cold start Go 100–300 ms |
| Docker stop grace | 10 s mặc định; K8s terminationGracePeriodSeconds 30 s |
| Postgres ADD COLUMN DEFAULT hằng | không rewrite từ PG 11 |

### Sai lầm hay gặp
- Rename/đổi kiểu cột trong một migration; chạy CREATE INDEX thường trên bảng 10 triệu dòng giờ cao điểm.
- Quên dependent schema (FDW, view, MV) nên migration "thành công" mà API 500.
- Kéo [[latest]] cho DB/broker/cache; auto-update hạ tầng không qua staging.
- Bake config/secret vào image; FE build một lần dùng nhiều môi trường với NEXT_PUBLIC_*.
- Không có memory limit; không có readiness probe nên rolling update đẩy traffic vào pod chưa sẵn sàng.
- Lambda sửa env bằng tay trên console; pipeline khác redeploy ghi đè.
- Flag sống mãi, không ai nhớ bật cho tenant nào.
- Rollback chưa bao giờ thử; đến lúc cần mới phát hiện migration không lùi được.

### Nói thế nào trong phỏng vấn (EN)
- "I would deploy with a canary that takes 10 percent of traffic and compare error rate and p99 against the baseline before promoting." — Canary 10% so với baseline trước khi promote.
- "Every schema change follows expand, migrate, contract, so version N and N-1 can run side by side." — Mọi thay đổi schema theo expand-migrate-contract để N và N-1 chạy song song.
- "Indexes on large tables are created concurrently with a short lock timeout, never inside a blocking transaction." — Index trên bảng lớn tạo concurrently với lock timeout ngắn.
- "Images are pinned by digest, configuration comes from the environment, and the service fails fast when a required setting is missing." — Image pin theo digest, config từ env, thiếu thì fail fast.
- "Every container gets a memory limit; otherwise one leak takes down the node and leaves no trace." — Mọi container có memory limit, không thì một rò rỉ hạ cả node.
- "Lambda fits bursty, event-driven work under fifteen minutes; for long-running or steady high load I would use containers." — Lambda hợp tải bursty dưới 15 phút; tải dài hoặc đều thì dùng container.
- "Infrastructure, including Lambda environment variables, lives in Terraform so nothing drifts between deploys." — Hạ tầng kể cả env Lambda nằm trong Terraform để không drift.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Pin ngay toàn bộ image hạ tầng trong docker-compose (postgres, rabbitmq, redis, mongo, elasticsearch, minio) theo tag cụ thể hoặc digest; cấu hình Watchtower chỉ theo dõi image do team build (label [[com.centurylinklabs.watchtower.enable]]). Đây là fix một dòng cho sự cố #13 và là bằng chứng "pin version" trong ADR.
- Thêm [[mem_limit]] (ví dụ worker 3 GiB, apiserver 1 GiB) và [[restart: unless-stopped]] cho mọi service compose; sau đó OOM sẽ hiện [[OOMKilled=true]] và kích hoạt alert thay vì làm host OOM toàn cục (sự cố #3, và các đợt OOM host canary/pilot).
- Checklist migration mới trong repo: (1) chỉ expand trong release này, contract ở release sau; (2) [[CREATE INDEX CONCURRENTLY]] + [[lock_timeout = 5s]]; (3) bước refresh FDW foreign table trên mọi DB đang nối ([[IMPORT FOREIGN SCHEMA]] lại hoặc ALTER FOREIGN TABLE) và test gọi API qua đường FDW — sự cố #5 chỉ hết khi đây là bước bắt buộc, không phải trí nhớ cá nhân; (4) index còn thiếu trên prod so với migration (đã thấy thiếu 8 index) phải có job đối chiếu [[pg_indexes]] vs migration.
- Lambda enrichment: chuyển toàn bộ định nghĩa (env REDIS_HOST, RABBITMQ_*, timeout, memory, reserved concurrency) vào Terraform/SAM; thêm bước kiểm tra sau deploy gọi một invoke smoke test có kiểm tra config. Sự cố #2 không lặp lại nếu deploy bằng tay bị cấm về mặt kỹ thuật.
- FE: NEXT_PUBLIC_* bake lúc build (sự cố #10, cả OTel endpoint localhost). Lựa chọn: build image riêng theo môi trường trong CI với build-arg rõ ràng, hoặc chuyển sang runtime config (endpoint [[/api/config]] đọc env server-side). Viết ADR chọn một trong hai.
- Deploy strategy hiện là recreate qua Watchtower 30 s. Bước nâng cấp rẻ nhất: chạy 2 replica apiserver sau nginx/NPM với health check để có rolling; canary theo tenant nội bộ bằng header hoặc flag trước khi mở cho khách Nhật.
- Feature flag đầu tiên: thuật toán reconcile policy mới chạy shadow (ghi kết quả vào bảng tạm, không xoá violation) để tránh lặp lại wipe one-shot (sự cố #14); so sánh 1 tuần rồi mới bật.
- Viết rollback plan mẫu cho release 2.3.0: lệnh đổi tag image, migration nào lùi được, dữ liệu nào không lùi được (cột mới nullable thì không cần lùi), và diễn tập trên staging một lần.
`,
  quiz: [
    { t: 'mc', q: 'Blue-green so với canary: phát biểu nào đúng?', o: ['Blue-green có blast radius nhỏ hơn canary', 'Cả hai đều yêu cầu downtime ngắn', 'Canary cần gấp đôi tài nguyên, blue-green thì không', 'Blue-green rollback tức thì bằng cách chuyển LB về môi trường cũ nhưng tốn gấp đôi tài nguyên; canary giảm blast radius bằng cách mở dần theo % traffic'], a: 3, why: 'Cả hai đều cần N và N-1 tương thích về API và schema.' },
    { t: 'mc', q: 'Vì sao rename cột phải làm hai bước (thêm cột mới, sau đó xoá cột cũ) thay vì một lệnh RENAME?', o: ['Vì trong rolling deploy, code bản cũ và bản mới chạy song song; rename một bước làm bản cũ (hoặc mới) lỗi ngay', 'Vì Postgres không hỗ trợ RENAME COLUMN', 'Vì RENAME làm rewrite toàn bộ bảng', 'Vì ORM không cho phép đổi tên'], a: 0, why: 'Expand-migrate-contract giữ tương thích N-1; mỗi bước là một deploy có thể lùi.' },
    { t: 'mc', q: 'Sau migration thêm cột, ứng dụng trả 500 "column does not exist" dù cột đã có trong DB chính. Nguyên nhân khả dĩ nhất?', o: ['Index chưa được tạo', 'Connection pool cache câu lệnh cũ', 'Một dependent schema (foreign table FDW, view) giữ bản sao schema cũ và chưa được refresh', 'Cột được thêm là nullable'], a: 2, why: 'FDW/view/MV đóng băng định nghĩa cột; checklist migration phải có bước refresh dependents và test qua đường đó.' },
    { t: 'mc', q: 'Container Go bị giết vì hết bộ nhớ nhưng docker inspect báo OOMKilled=false và không có dấu vết. Thiết lập nào thiếu?', o: ['Liveness probe', 'Memory limit cho container; không có limit thì tiến trình bị kernel OOM killer của host giết, không phải cgroup của container', 'CPU limit', 'Readiness probe'], a: 1, why: 'Có memory limit thì OOM xảy ra trong cgroup container, inspect thấy OOMKilled=true và metric/alert bắt được.' },
    { t: 'mc', q: 'Trường hợp nào KHÔNG nên dùng AWS Lambda?', o: ['Job chạy liên tục 40 phút, hoặc consumer giữ kết nối dài tới RabbitMQ', 'Xử lý file upload theo sự kiện S3', 'Enrichment batch theo lịch, tải bursty', 'Webhook handler nhẹ'], a: 0, why: 'Lambda timeout tối đa 15 phút và không giữ kết nối dài; dùng container hoặc Step Functions chia nhỏ.' },
    { t: 'fill', q: 'Điền: lệnh Postgres tạo index trên bảng lớn mà không chặn ghi là CREATE INDEX ___.', a: ['concurrently'], why: 'Không chạy được trong transaction, chậm hơn và có thể để lại index INVALID cần kiểm tra lại.' },
    { t: 'fill', q: 'Điền: mẫu thay đổi schema ba giai đoạn để không downtime và tương thích N-1 gọi là expand -> migrate -> ___.', a: ['contract'], why: 'Contract (xoá cột/bảng cũ) chỉ làm khi không còn bản code nào đọc/ghi nó.' },
    { t: 'open', q: 'Interviewer: "How do you ship a change that adds a column and a new index to a 50-million-row table without downtime, when a read replica and a foreign-data-wrapper consumer also read that table?" Trả lời 4–6 câu.', a: 'Expand trước: ADD COLUMN nullable (không rewrite), CREATE INDEX CONCURRENTLY với lock_timeout ngắn ngoài giờ cao điểm, kiểm tra index không INVALID. Refresh mọi dependent schema: ALTER FOREIGN TABLE hoặc IMPORT FOREIGN SCHEMA lại ở DB dùng FDW, kiểm tra view/MV, và chạy test tích hợp qua đường FDW trước khi deploy code. Deploy code đọc/ghi cột mới sau feature flag, canary theo tenant nội bộ, theo dõi error rate và p99 so với baseline. Backfill theo lô nhỏ có sleep. Contract (nếu có cột cũ cần bỏ) để release sau; rollback plan là tắt flag và đổi tag image, cột mới nullable không cần lùi.', keys: ['concurrently', 'expand', 'foreign', 'flag', 'canary'] }
  ]
},
{ id: 'B19', type: 'block', topic: 'design', title: 'Kiến trúc SaaS multi-tenant: mô hình tenancy, noisy neighbor, quota, cách ly dữ liệu, cache theo tenant, metering', time: '130 phút',
  goal: 'So sánh ba mô hình tenancy bằng con số và chọn đúng cho từng lớp dữ liệu, thiết kế tenant context propagation và fairness trong pipeline nền để một tenant không chiếm hết hệ thống, và nêu được cách xử lý dữ liệu dùng chung, metering, onboarding/offboarding.',
  md: `
### Vấn đề cần giải
- SaaS có nghĩa là hàng trăm khách dùng chung một hệ thống để chi phí mỗi khách thấp. Nhưng "dùng chung" là nguồn của ba rủi ro: **leak** (khách A thấy dữ liệu khách B), **noisy neighbor** (khách A làm chậm khách B), và **khó vận hành** (một migration cho tất cả, một khách đòi restore riêng).
- Hệ thống của bạn đã gặp cả ba: license declared leak cross-tenant vì dữ liệu dùng chung kiểu first-writer-wins (sự cố #15); một tenant stress test đổ 5 file 200k component không có purl tạo 696k dòng pending chiếm toàn bộ pipeline enrichment (sự cố #16), sweeper nghẹt (sự cố #8); và câu hỏi "tenant này dùng bao nhiêu" chưa trả lời được bằng số.
- Multi-tenant là quyết định kiến trúc xuyên suốt: DB, cache, queue, search, log, billing — mỗi lớp phải biết tenant là ai.

### Cốt lõi
#### 1. Ba mô hình tenancy
| Tiêu chí | Shared schema + tenant_id | Schema-per-tenant | Database-per-tenant |
|---|---|---|---|
| Chi phí mỗi tenant | Thấp nhất (một dòng = một tenant) | Trung bình (hàng trăm schema làm catalog phình, connection pool khó share) | Cao (mỗi DB có RAM/connection riêng; RDS mỗi instance tính tiền) |
| Cách ly dữ liệu | Logic (WHERE + RLS); một bug = leak | Tốt hơn (search_path); vẫn chung instance | Mạnh nhất; restore/encrypt/khoá riêng từng khách |
| Noisy neighbor | Cao: chung bảng, chung index, chung buffer | Trung bình: chung CPU/IO | Thấp (nếu instance riêng) |
| Migration | Một lần cho tất cả; bảng lớn nên migration chậm | N lần, phải loop và xử lý thất bại giữa chừng | N lần, có thể lệch phiên bản schema giữa khách |
| Scale | Shard theo tenant_id khi bảng quá lớn | Chuyển schema sang instance khác | Chuyển DB sang instance khác dễ |
| Tuỳ biến per tenant | Khó (cột chung) | Dễ hơn | Dễ nhất |
| Hợp với | Hàng nghìn tenant nhỏ–vừa, team nhỏ | Vài chục–trăm tenant, cần cách ly logic rõ | Khách enterprise trả cao, yêu cầu compliance/data residency |

- Thực tế phổ biến: **hybrid** — pool shared schema cho đa số, database riêng (hoặc cell riêng) cho vài khách lớn/đòi hỏi. Thiết kế code để **cùng codebase** phục vụ cả hai bằng cách resolve connection theo tenant (tenant catalog -> DSN).
- **Cell-based architecture**: chia toàn bộ stack thành các cell độc lập, mỗi cell phục vụ một nhóm tenant; blast radius = một cell. Đây là mức tiếp theo khi hệ lớn.

#### 2. Tenant context propagation
- Tenant xác định từ **token** (claim tenant_id/org) hoặc subdomain đã verify, không từ body/param. Middleware gắn vào [[context.Context]]; repository đọc từ context, không nhận tenant_id như tham số tuỳ ý — API quen tay [[repo.GetProject(ctx, id)]] tự thêm WHERE tenant.
- Đi qua ranh giới async: tenant_id vào **message header** và payload; worker/Lambda khôi phục context trước khi xử lý. Thiếu tenant trong message = reject vào DLQ, không được "đoán".
- **Row-level security**: [[SET LOCAL app.tenant_id]] mỗi transaction (pool dùng chung); policy [[USING (tenant_id = current_setting('app.tenant_id')::uuid)]]. Job hệ thống chạy với role BYPASSRLS, có log rõ. Overhead thường < 5% khi cột tenant_id có index đứng đầu.
- Mọi bảng tenant có cột tenant_id, index composite [[(tenant_id, ...)]] đứng đầu; phân vùng (partition) theo tenant chỉ khi vài tenant rất lớn ([[PARTITION BY LIST]] với partition default cho tenant nhỏ).

#### 3. Noisy neighbor: quota và fairness
- **Rate limit per tenant** ở API (token bucket theo tenant_id, hạn mức theo gói), **quota** theo tài nguyên (số project, component/tháng, dung lượng upload, số scan/ngày) kiểm tra trước khi nhận việc, trả 429/402 rõ ràng.
- **Queue fairness**: một hàng đợi FIFO chung là cách tenant lớn chiếm chỗ (sự cố #16). Phương án:
  - **Queue per tenant** + consumer **round-robin** (hoặc weighted theo gói) giữa các queue: mỗi vòng lấy 1 job từ mỗi tenant có việc. RabbitMQ: nhiều queue, consumer tự xoay vòng; hoặc một queue với **priority** (hạn chế: priority tĩnh).
  - **Fair scheduler** trong DB: chọn việc bằng [[DISTINCT ON (tenant_id)]] hoặc [[ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at)]] lấy top-k mỗi tenant mỗi vòng; cộng [[FOR UPDATE SKIP LOCKED]] khi nhiều worker.
  - **Concurrency cap per tenant** (semaphore trong Redis: tối đa 2 batch enrichment đồng thời mỗi tenant).
- **Worker pool per tier**: pool riêng cho tenant trả phí và tenant free/internal; tenant stress test nội bộ chạy trong pool riêng hoặc ngoài giờ.
- **Admission control** ở đầu vào: file 200k component không có purl nên bị đánh dấu [[no_locator]] ngay lúc parse thay vì tạo 200k dòng pending (fix thực tế của sự cố #16). Việc không thể làm thì không xếp hàng.
- Đo noisy neighbor: metric theo tenant ở log/trace (không label metric — bài B14), top-N tenant theo CPU/IO/queue time; p99 của tenant nhỏ khi tenant lớn đang chạy là SLI quan trọng.

:::diagram
FE[FE / CI của tenant] -> GW[Gateway - rate limit per tenant]
GW -> API[apiserver - tenant ctx từ JWT]
API -> PG[(Postgres tenant data + RLS)]
API -> Cache[Redis key t - tenant - ...]
API -> Q[Queue per tenant / fair scheduler] : tenant header
Q -> Pool_Paid[Worker pool tier paid] : weighted RR
Q -> Pool_Free[Worker pool tier free / internal]
Pool_Paid -> Lambda[Lambda enrichment - cap per tenant]
Pool_Free -> Lambda
Lambda -> Shared[(Shared vuln + license DB)]
Lambda -> Overlay[(Per-tenant overlay PRCL)]
PG -> Shared : FDW read-only
API -> Meter[Metering events] : usage
Meter -> Bill[Billing / invoice]
:::

#### 4. Cache và search theo tenant
- Cache key luôn có tenant prefix: [[t:{tenant}:project:{id}]]; invalidation theo prefix dùng tag/set hoặc version per tenant ([[t:{tenant}:ver]] tăng lên khi cần xoá hết). Không có prefix -> cache poisoning cross-tenant: tenant A đọc được object của B cùng id.
- Giới hạn bộ nhớ cache per tenant (hoặc theo tier) để một tenant không đẩy hết cache của người khác (LRU chung sẽ ưu tiên tenant nói nhiều).
- Search index: filter tenant_id bắt buộc, routing theo tenant (bài B11). Log: field tenant_id để truy và để tính chi phí.

#### 5. Dữ liệu dùng chung vs dữ liệu riêng
- **Dữ liệu chung** (vulnerability feed OSV/NVD/GHSA, license metadata từ ClearlyDefined, package catalog) không có tenant: cập nhật bởi job hệ thống, đọc bởi mọi tenant. Lưu ở DB/schema riêng (FDW read-only hoặc replica), hoặc bảng không tenant_id với quyền chỉ đọc cho tenant path.
- **Dữ liệu riêng**: component của tenant, policy, kết quả eval, override. Khi tenant **sửa** thứ thuộc dữ liệu chung (khai báo license khác, đánh dấu false positive), đó là **overlay per-tenant**: bảng [[tenant_license_override(tenant_id, component_key, value)]]; view tenant = COALESCE(overlay, shared). Sự cố #15 là hệ quả của ghi thẳng vào bảng chung theo first-writer-wins — hai tenant cùng component nhưng khai báo khác nhau ghi đè nhau.
- Quy tắc: **shared chỉ ghi bởi hệ thống; tenant chỉ ghi vào overlay**. Mọi hàm ghi vào bảng chung phải kiểm tra không có tenant trong context (hoặc ngược lại) — một assert rẻ tiền chặn cả lớp bug.
- FDW/separate DB cho dữ liệu chung tạo giới hạn riêng: join xuyên FDW chậm, schema đóng băng (sự cố #5), timeout khác; cân nhắc **materialize** phần cần join vào DB tenant (bảng vulnerability tóm tắt theo component_key) cập nhật theo event.

#### 6. Metering, billing, vòng đời tenant
- **Metering event**: mỗi hành động tính tiền (scan hoàn tất, component được enrich, GB lưu trữ-ngày, seat) phát một event bất biến [[(tenant_id, metric, quantity, ts, idempotency_key)]] vào bảng/stream riêng; aggregate theo kỳ -> hoá đơn. Không tính tiền từ bảng nghiệp vụ trực tiếp (dữ liệu bị xoá, sửa).
- Idempotency key để retry không tính hai lần; đối chiếu định kỳ meter vs thực tế; hiển thị usage cho khách để tự kiểm tra (giảm tranh cãi hoá đơn).
- **Onboarding**: tạo tenant = transaction tạo bản ghi tenant, cấu hình gói, seed role/policy mặc định, (nếu DB riêng) provision bằng IaC + migration tới đúng version; cho phép SSO config, domain verify. Tự động hoá hoàn toàn — onboarding thủ công không scale và dễ sai quyền.
- **Offboarding / GDPR / APPI (Nhật)**: export dữ liệu (định dạng mở, có checksum, presigned URL), xoá theo lịch (soft delete -> grace 30 ngày -> hard delete kể cả backup/cache/search index/log có PII), chứng nhận xoá cho khách. Shared schema làm xoá khó hơn ([[DELETE WHERE tenant_id]] trên hàng chục bảng, cần thứ tự FK và chạy theo lô); database-per-tenant thì [[DROP DATABASE]].
- **Data residency**: khách Nhật có thể yêu cầu dữ liệu ở region Tokyo; cell/DB riêng theo region là lý do thực tế nhất để rời shared schema.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| Overhead RLS | thường < 5% khi index có tenant_id đứng đầu |
| Schema-per-tenant | bắt đầu khó từ vài trăm schema (catalog, pool, migration loop) |
| Database-per-tenant | mỗi RDS instance tính tiền riêng; Aurora cho phép nhiều DB trong một cluster |
| Grace period xoá | 30 ngày soft delete, sau đó hard delete cả backup theo retention |
| Fairness | round-robin/weighted giữa tenant; cap concurrency 1–2 batch mỗi tenant |
| Sự cố #16 | 696k pending từ 5 file; admission control + partial index: phút -> ms |

### Sai lầm hay gặp
- Nhận tenant_id từ body/query; hoặc repository có hàm "GetByID" không tenant vì "chỉ dùng nội bộ" rồi được dùng ở API.
- Hàng đợi FIFO chung; tenant lớn (hoặc stress test nội bộ) chiếm hết worker, tenant trả phí chờ hàng giờ.
- Cache key không có tenant prefix; hoặc invalidation xoá cache của mọi tenant mỗi khi một tenant đổi.
- Ghi dữ liệu tenant vào bảng dùng chung (first-writer-wins) -> leak và kết quả khác nhau tuỳ ai upload trước.
- Chọn database-per-tenant từ ngày đầu cho 500 tenant nhỏ -> migration loop 500 lần, chi phí instance.
- Tính tiền từ bảng nghiệp vụ, không có metering event -> không giải thích được hoá đơn khi dữ liệu đã xoá.
- Offboarding quên xoá search index, cache, log, backup; hoặc không có export trước khi xoá.

### Nói thế nào trong phỏng vấn (EN)
- "I would start with a shared schema and a tenant id on every table, enforced by middleware and row-level security, and move only the largest customers to dedicated databases." — Bắt đầu shared schema + tenant_id, RLS; khách lớn nhất mới tách DB riêng.
- "Tenant identity comes from the verified token and is propagated through the request context and message headers; nothing trusts a tenant id from the client payload." — Tenant lấy từ token đã verify, truyền qua context và message header.
- "To avoid noisy neighbors I rate-limit per tenant at the edge and schedule background work fairly, round-robin across tenants with a concurrency cap per tenant." — Chống noisy neighbor bằng rate limit per tenant và lập lịch công bằng round-robin có cap.
- "Shared reference data is written only by system jobs; tenant-specific changes go to an overlay table and are merged at read time." — Dữ liệu chung chỉ hệ thống ghi; tenant ghi vào overlay, merge lúc đọc.
- "Cache keys are prefixed with the tenant id, and search queries always carry a tenant filter." — Cache key có tenant prefix, search luôn có tenant filter.
- "Billing is driven by immutable metering events with idempotency keys, not by querying business tables." — Tính tiền từ metering event bất biến có idempotency key.

`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Mô hình hiện tại: shared schema + tenant_id cho dữ liệu tenant, DB vulnerability chung nối qua FDW. Hợp lý cho quy mô hiện tại; viết ADR xác nhận và ghi tiêu chí khi nào một khách Nhật được tách database riêng (data residency Tokyo, yêu cầu restore riêng, > X% tổng tải).
- Sự cố #15 đã fix bằng overlay per-tenant (PRCL) — hệ thống hoá thành quy tắc kiến trúc: bảng chung (t_components license từ ClearlyDefined, vulnerability) chỉ job hệ thống ghi; mọi giá trị do tenant upload/sửa vào bảng overlay; view tenant = COALESCE. Thêm assert trong repository: hàm ghi bảng chung panic nếu context có tenant.
- Sự cố #16 và #8: (1) admission control lúc parse — component không có purl đánh dấu no_locator ngay, không tạo pending; (2) sweeper chọn việc công bằng: [[ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY next_attempt_at)]] lấy tối đa 20 dòng mỗi tenant mỗi vòng, [[FOR UPDATE SKIP LOCKED]]; (3) cap 2 batch Lambda đồng thời mỗi tenant bằng Redis semaphore; (4) tenant stress test nội bộ gắn tier internal chạy pool riêng.
- Rate limit per tenant ở apiserver cho upload và export (token bucket Redis, hạn mức theo gói); quota số component/tháng kiểm tra trước khi nhận file. Trả 429 kèm Retry-After và hiển thị usage ở dashboard tenant.
- Cache Redis: audit mọi key hiện có xem có tenant prefix chưa (đặc biệt cache license/vulnerability dùng chung — không prefix là đúng, nhưng cache kết quả policy/project phải có). Enrichment cache chung giữa tenant là hợp lệ vì là dữ liệu chung.
- Metering: phát event [[scan.completed]], [[components.enriched]] với tenant_id, quantity, idempotency_key vào bảng t_metering_events append-only; aggregate theo tháng. Hiện tại chưa có cách trả lời "tenant X dùng bao nhiêu Lambda phút" — đây là số cần cho pricing.
- Offboarding: viết runbook xoá tenant theo thứ tự FK, theo lô 10k dòng, kèm xoá ES index routing tenant, cache prefix, object S3 theo prefix tenant, và export trước khi xoá. Khách Nhật sẽ hỏi câu này trong đánh giá bảo mật (APPI).
- Việc tuần này: đo p99 API của tenant nhỏ trong lúc tenant lớn chạy scan (SLI noisy neighbor), đếm số dòng pending theo tenant để xác nhận fairness, và viết ADR về overlay/shared.
`,
  quiz: [
    { t: 'mc', q: 'Lý do thực tế nhất để chuyển một tenant từ shared schema sang database riêng là gì?', o: ['Tenant có nhiều user hơn trung bình', 'Yêu cầu compliance/data residency, restore riêng, hoặc tenant quá lớn gây noisy neighbor không kiểm soát được', 'Để migration chạy nhanh hơn cho mọi tenant', 'Vì RLS không hoạt động với hơn 100 tenant'], a: 1, why: 'Database-per-tenant trả giá bằng chi phí instance và migration N lần, nên chỉ dùng khi có yêu cầu cách ly thật.' },
    { t: 'mc', q: 'Pipeline nền dùng một hàng đợi FIFO chung; một tenant đẩy 696k job. Cách sửa đúng về mặt thiết kế?', o: ['Tăng số worker gấp đôi', 'Xoá job của tenant đó', 'Lập lịch công bằng: lấy top-k job mỗi tenant mỗi vòng (round-robin/weighted), cap concurrency per tenant, và từ chối sớm job không thể xử lý ở đầu vào', 'Chuyển sang xử lý theo thứ tự tenant tạo trước'], a: 2, why: 'Fairness và admission control giữ SLA cho tenant khác; tăng worker chỉ làm tenant lớn chạy nhanh hơn.' },
    { t: 'mc', q: 'Hai tenant upload cùng một component nhưng khai báo license khác nhau; hệ thống ghi vào bảng component dùng chung theo kiểu ai ghi trước thắng. Hậu quả và cách sửa?', o: ['Leak và kết quả phụ thuộc thứ tự upload; sửa bằng bảng overlay per-tenant và merge lúc đọc, bảng chung chỉ hệ thống ghi', 'Không có vấn đề vì license là dữ liệu công khai', 'Sửa bằng cách khoá bảng khi ghi', 'Sửa bằng cách tạo index unique trên license'], a: 0, why: 'Shared data phải tách khỏi tenant-specific data; overlay COALESCE giữ cả hai đúng.' },
    { t: 'mc', q: 'Vì sao cache key phải có tenant prefix ngay cả khi id của object là UUID toàn cục duy nhất?', o: ['Vì Redis yêu cầu prefix', 'Vì TTL phụ thuộc tenant', 'Vì prefix giúp nén dữ liệu', 'Vì cùng một object có thể có view khác nhau theo tenant (overlay, quyền), và quét/xoá cache theo tenant cần prefix; thiếu prefix là nguồn cache poisoning khi id trùng'], a: 3, why: 'Prefix cho phép invalidation theo tenant và tránh phục vụ dữ liệu đã được overlay của tenant khác.' },
    { t: 'mc', q: 'Metering cho billing nên dựa trên gì?', o: ['COUNT trên bảng nghiệp vụ lúc cuối tháng', 'Event metering bất biến có idempotency key, phát khi hành động tính tiền xảy ra, aggregate theo kỳ', 'Log ứng dụng', 'Số request HTTP ở gateway'], a: 1, why: 'Bảng nghiệp vụ bị xoá/sửa; event bất biến giải thích được hoá đơn và chịu được retry.' },
    { t: 'fill', q: 'Điền: hiện tượng một tenant tiêu thụ tài nguyên dùng chung quá mức làm giảm hiệu năng của tenant khác gọi là ___ neighbor.', a: ['noisy', 'noisy neighbor'], why: 'Chống bằng rate limit/quota per tenant, fair scheduling, pool per tier, admission control.' },
    { t: 'fill', q: 'Điền: trong mô hình tenant thay đổi dữ liệu dùng chung, bảng ghi riêng theo tenant được merge với dữ liệu chung lúc đọc (COALESCE) gọi là ___ per-tenant.', a: ['overlay', 'override', 'overlay table'], why: 'Shared chỉ hệ thống ghi; tenant ghi vào overlay; đây là fix của sự cố leak license cross-tenant.' },
    { t: 'open', q: 'Interviewer: "Design the tenancy model for a B2B SaaS with 500 small customers and 5 enterprise customers who demand isolation. How do you keep one customer from degrading the others?" Trả lời 4–6 câu.', a: 'Hybrid: shared schema với tenant_id và row-level security cho 500 khách nhỏ; database (hoặc cell) riêng cho 5 khách enterprise, cùng codebase resolve connection qua tenant catalog. Tenant lấy từ token, truyền qua context và message header; mọi query, cache key, search filter đều có tenant. Chống noisy neighbor bằng rate limit và quota per tenant ở biên, hàng đợi lập lịch công bằng round-robin có cap concurrency per tenant, pool worker theo tier, và admission control từ chối việc không hợp lệ ngay đầu vào. Dữ liệu tham chiếu dùng chung chỉ hệ thống ghi, tenant ghi overlay. Metering event bất biến để tính tiền và để thấy tenant nào dùng gì; onboarding/offboarding tự động kể cả export và xoá theo lịch.', keys: ['shared schema', 'row-level security', 'rate limit', 'fair', 'overlay'] }
  ]
},
{ id: 'B20', type: 'block', topic: 'realtime', title: 'Giao tiếp thời gian thực: WebSocket ở quy mô lớn, pub/sub fan-out, presence, push notification, SSE', time: '120 phút',
  goal: 'Thiết kế được lớp WebSocket gateway stateful scale ngang (connection registry, pub/sub routing, heartbeat/reconnect), chọn đúng giữa WebSocket/SSE/long polling/push, và giải thích fan-out, presence, ordering/dedup bằng con số.',
  md: `
### Vấn đề cần giải
- Dashboard SBOM đang **polling** [[GET /scans/{id}]] mỗi 5 giây để biết scan xong chưa: 1000 tab mở = 200 request/giây vào API và DB chỉ để nghe "chưa xong", độ trễ thông báo trung bình 2,5 giây, và vẫn không biết khi worker chết. Polling đổi độ trễ lấy tải: chu kỳ ngắn thì tốn, dài thì chậm.
- Chat, cộng tác, giá cả, trạng thái job cần **server đẩy** tới client ngay khi có sự kiện. HTTP là request/response; đẩy ngược cần kết nối giữ mở — và kết nối giữ mở là **state** trên server, thứ mà kiến trúc stateless đã cố tránh.
- Vấn đề thật không phải mở WebSocket (một dòng code) mà là: 1 triệu kết nối nằm trên 50 node gateway, sự kiện của user X phát sinh ở worker Y, làm sao tới đúng node đang giữ kết nối của X trong vài chục ms, khi node chết thì sao, khi client mất mạng thì sao, khi client offline hẳn thì sao.

### Cốt lõi
#### 1. Chọn giao thức
| | Long polling | SSE (Server-Sent Events) | WebSocket | Push (APNs/FCM) |
|---|---|---|---|---|
| Chiều | Server -> client (giả lập) | Server -> client | Hai chiều | Server -> thiết bị offline |
| Giao thức | HTTP thường | HTTP, [[text/event-stream]] | Nâng cấp từ HTTP/1.1, frame nhị phân | HTTPS tới Apple/Google |
| Proxy/LB | Dễ | Dễ (HTTP), tự reconnect có [[Last-Event-ID]] | Cần LB hỗ trợ upgrade, idle timeout | Không liên quan |
| Overhead | Cao (header mỗi lần) | Thấp | Thấp nhất, 2–14 byte header mỗi frame | Giới hạn payload 4 KB |
| Hợp khi | Fallback, môi trường hạn chế | Thông báo, tiến trình, feed một chiều | Chat, cộng tác, game, cần client gửi nhiều | Người dùng không mở app |

- Nguyên tắc: **một chiều thì SSE**, hai chiều mới WebSocket. SSE đi qua HTTP/2 multiplex tốt, tự reconnect, đơn giản hơn nhiều về ops. HTTP/1.1 giới hạn 6 kết nối mỗi origin — SSE trên HTTP/1.1 với nhiều tab sẽ hết slot; HTTP/2 giải quyết.

#### 2. WebSocket gateway stateful và scale ngang
- Tách **gateway** (chỉ giữ kết nối, auth, heartbeat, forward) khỏi **service nghiệp vụ** (stateless). Gateway là tầng mỏng, ít thay đổi, deploy ít; nghiệp vụ deploy thoải mái không rớt kết nối.
- **Connection registry**: khi client kết nối, gateway ghi [[user_id -> {gateway_id, conn_id, ts}]] vào Redis (hash/set với TTL = vài lần heartbeat). Một user nhiều thiết bị = nhiều entry.
- **Routing message**: service nghiệp vụ muốn gửi cho user X: (a) tra registry rồi gửi tới đúng gateway qua RPC, hoặc (b) **publish lên pub/sub** (Redis Pub/Sub, NATS, Kafka) theo channel [[user:X]]; mỗi gateway **subscribe** channel của các user nó đang giữ. (b) đơn giản và chịu lỗi tốt hơn; Redis Pub/Sub là fire-and-forget (gateway offline thì mất), nên kèm lưu message để client kéo lại khi reconnect.
- **Sticky vs stateless**: LB không cần sticky session nếu mọi state nằm ở Redis và client reconnect bất kỳ node nào rồi đồng bộ lại; sticky chỉ cần cho handshake nhiều bước (Socket.IO long-polling fallback).
- Khi gateway chết: TTL registry hết -> entry biến mất; client phát hiện qua heartbeat và reconnect sang node khác với **backoff + jitter** (1 s, 2 s, 4 s... tối đa 30 s) — không có jitter thì 20k client cùng về một lúc (thundering herd) hạ node tiếp theo.
- **Heartbeat**: ping/pong mỗi 20–30 s (dưới idle timeout của LB/NAT, thường 60 s); 2 lần không pong -> đóng kết nối, dọn registry.
- **Scale theo kết nối**: mỗi kết nối idle tốn ~10–50 KB RAM (buffer + goroutine ~4–8 KB ở Go); 100k kết nối ≈ 1–5 GB; giới hạn file descriptor (ulimit), port ephemeral chỉ là vấn đề phía client. Node Go/Erlang giữ 100k–1M kết nối idle được; nút cổ chai là **message/giây**, không phải số kết nối.

:::diagram
Client[Browser / Mobile] -> LB[LB - WS upgrade, idle 60s]
LB -> GW1[Gateway node 1]
LB -> GW2[Gateway node 2]
GW1 -> Reg[Redis registry user to node, TTL] : register + heartbeat
GW2 -> Reg
GW1 -> PubSub[Redis Pub/Sub / NATS] : subscribe user channels
GW2 -> PubSub
Worker[Worker / apiserver] -> Store[Message / event store + seq] : persist first
Worker -> PubSub : publish user X
PubSub -> GW1 : deliver to conn
Presence[Presence service] -> Reg : last seen
Worker -> Push[Push service APNs / FCM] : if offline
Push -> Device[Device offline]
:::

#### 3. Fan-out: write vs read
- Sự kiện một người gửi, N người nhận (group chat 500 người, follower 10 triệu).
- **Fan-out on write**: khi sự kiện xảy ra, ghi vào inbox/timeline của từng người nhận (N lần ghi), đọc rẻ (1 lần). Hợp khi N nhỏ–vừa (< vài nghìn) và đọc nhiều hơn ghi.
- **Fan-out on read**: chỉ ghi 1 lần, người đọc tự gom từ các nguồn mình theo dõi lúc đọc. Hợp cho **celebrity** (10 triệu follower: ghi 10 triệu inbox mỗi post là không thể).
- **Hybrid** (Twitter): fan-out on write cho người thường, fan-out on read cho tài khoản > ngưỡng follower; merge lúc đọc. Trong SaaS: thông báo tới mọi thành viên tenant (vài chục–trăm) là fan-out on write; broadcast toàn hệ thống (bảo trì) là một channel chung mọi người subscribe (fan-out on read).

#### 4. Presence
- Trạng thái online/offline/last seen của hàng triệu user thay đổi liên tục; nếu mỗi thay đổi broadcast tới mọi bạn bè thì lưu lượng = O(user × friend).
- Cách làm: online = key Redis [[presence:{user}]] với **TTL** (ví dụ 60 s) được heartbeat gia hạn; offline = key hết hạn (không cần sự kiện logout tin cậy). **Last seen** ghi khi đóng kết nối hoặc theo chu kỳ thưa (vài phút), không mỗi heartbeat.
- Chỉ phát presence tới người **đang xem** (đang mở cuộc trò chuyện/danh sách) thay vì toàn bộ danh bạ; client subscribe/unsubscribe theo màn hình. Debounce flapping (mạng chập chờn) 5–10 s trước khi báo offline.

#### 5. Ordering, dedup, reconnect
- Pub/sub không bảo đảm thứ tự xuyên node và "at-most-once" (Redis) hoặc "at-least-once" (Kafka/NATS JetStream). Client phải chịu được **trùng** và **lộn thứ tự**.
- Cách chuẩn: server gán **sequence number tăng đơn điệu per stream** (per conversation/per user inbox) lúc **persist** (DB/log) trước khi publish; client giữ [[last_seq]], bỏ qua seq ≤ last_seq (dedup), nếu nhận seq nhảy cách thì gọi [[GET /messages?after=last_seq]] để lấp lỗ. Reconnect = gửi last_seq, server replay từ store — giống SSE [[Last-Event-ID]].
- Client gửi lên kèm **client_msg_id** (UUID) để server dedup khi client retry sau mất mạng; ack về client bằng cùng id.
- Nguyên tắc **persist trước, publish sau**: pub/sub chỉ là tín hiệu "có cái mới", store là chân lý. Mất tín hiệu thì client lấp lỗ khi reconnect; mất store thì không gì cứu được.

#### 6. Offline: push notification
- User không có kết nối (app đóng) -> gửi qua **APNs** (Apple) / **FCM** (Google/web push). Server giữ **device token registry** [[(user_id, device_token, platform, app_version, updated_at)]]; token đổi theo thời gian — xử lý phản hồi [[Unregistered]]/[[410]] để xoá token chết (Apple/Google phạt gửi tới token hỏng).
- **Collapse key / thread-id**: nhiều thông báo cùng loại gộp thành một ("5 scan hoàn tất") thay vì 5 banner; payload ≤ 4 KB, chỉ chứa tóm tắt + id, app mở rồi kéo chi tiết (không đưa dữ liệu nhạy cảm vào push).
- Quyết định gửi push: nếu registry không có kết nối WebSocket **và** chưa đọc sau N giây (tránh vừa hiện realtime vừa rung điện thoại). Hàng đợi riêng cho push, rate limit per user (không quá X push/giờ), tôn trọng múi giờ/giờ yên lặng.
- Email/Slack/Teams webhook là kênh "push" của SaaS B2B — khách Nhật dùng Teams/Slack nhiều hơn mobile push cho công cụ nội bộ.

### Số liệu cần nhớ
| Con số | Giá trị |
|---|---|
| RAM mỗi kết nối WS idle | ~10–50 KB (Go goroutine 4–8 KB + buffer); 100k kết nối ≈ 1–5 GB |
| Heartbeat | 20–30 s, dưới idle timeout LB/NAT (~60 s); 2 lần miss -> đóng |
| Reconnect backoff | 1 s nhân đôi tới 30 s, full jitter |
| HTTP/1.1 | tối đa 6 kết nối mỗi origin (SSE nhiều tab cần HTTP/2) |
| Push payload | APNs/FCM ≈ 4 KB |
| Presence TTL | 60 s, debounce offline 5–10 s |
| Fan-out on write | hợp khi người nhận < vài nghìn; celebrity dùng fan-out on read |

### Sai lầm hay gặp
- Giữ kết nối WebSocket trong cùng process với nghiệp vụ -> mỗi deploy rớt toàn bộ client và tạo reconnect storm.
- Chỉ dùng Redis Pub/Sub, không persist -> gateway restart là mất message, client không có cách lấp lỗ.
- Không heartbeat -> LB/NAT cắt kết nối im lặng sau 60 s, client tưởng vẫn kết nối, server giữ kết nối ma.
- Reconnect ngay lập tức không backoff/jitter -> thundering herd sau sự cố.
- Dùng WebSocket cho thứ chỉ cần server -> client (tiến trình, thông báo) trong khi SSE đơn giản hơn, qua proxy dễ hơn.
- Presence broadcast tới toàn bộ danh bạ mỗi lần đổi; hoặc ghi last_seen mỗi heartbeat vào DB.
- Không dedup theo seq/client_msg_id -> hiển thị trùng tin nhắn sau reconnect.
- Giữ device token chết, không xử lý phản hồi Unregistered -> bị provider throttle.
- Nhét nội dung nhạy cảm vào push payload (hiện trên màn hình khoá).

### Nói thế nào trong phỏng vấn (EN)
- "For one-way updates like job progress I would use Server-Sent Events; WebSocket only when the client also needs to send a lot." — Cập nhật một chiều thì SSE; WebSocket khi client cũng gửi nhiều.
- "A thin stateful gateway holds connections, registers user-to-node in Redis with a TTL, and subscribes to per-user channels on a pub/sub bus." — Gateway mỏng giữ kết nối, đăng ký user-node trong Redis có TTL, subscribe channel per user.
- "Events are persisted with a per-stream sequence number before they are published; the client dedups by sequence and backfills gaps after reconnect." — Persist với seq trước khi publish; client dedup theo seq và lấp lỗ khi reconnect.
- "Heartbeats every 30 seconds keep the connection alive through load balancers, and reconnects use exponential backoff with jitter to avoid a thundering herd." — Heartbeat 30 s, reconnect backoff + jitter.
- "For large groups I fan out on write; for celebrity-scale audiences I fan out on read and merge at query time." — Nhóm lớn fan-out on write; celebrity fan-out on read.
- "If the user has no live connection, the notification falls back to push via APNs or FCM with a collapse key, and tokens are pruned on unregistered responses." — Không có kết nối thì push qua APNs/FCM với collapse key, dọn token chết.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Thay polling trạng thái scan bằng **SSE** endpoint [[GET /events?after={last_event_id}]] trên apiserver: mỗi tenant/user một stream, sự kiện [[scan.completed]], [[enrichment.progress]], [[policy.violation.new]]. Một chiều, qua nginx/NPM chỉ cần tắt buffering ([[proxy_buffering off]]) và tăng [[proxy_read_timeout]]; không cần WebSocket.
- Nguồn sự kiện: worker và Lambda đã có RabbitMQ; thêm consumer "notification fan-out" ghi vào bảng [[t_user_events(seq bigserial, tenant_id, user_id, type, payload, created_at)]] **trước**, rồi publish Redis channel [[tenant:{id}]]; apiserver subscribe và đẩy xuống SSE. Reconnect gửi [[Last-Event-ID]] = seq, apiserver replay từ bảng. Nhớ bài học sự cố #12: persist trước, publish sau.
- Fan-out: thông báo tenant-wide (scan xong) là fan-out on write tới thành viên tenant (vài chục người) — ghi N dòng là rẻ; broadcast hệ thống (bảo trì) là channel chung.
- Tính số: 1000 tab mở polling 5 s = 200 req/s vào DB; SSE 1000 kết nối idle ≈ 50 MB RAM apiserver và 0 query khi không có sự kiện. Đo trước/sau để đưa vào ADR.
- Nếu sau này cần hai chiều (cộng tác chỉnh sửa policy): tách gateway WebSocket riêng (process khác apiserver) để deploy apiserver không rớt kết nối; registry Redis TTL 90 s, heartbeat 30 s.
- Kênh offline cho khách Nhật: Slack/Teams webhook và email digest với collapse ("12 scan hoàn tất, 3 violation mới") thay vì mobile push; rate limit per tenant để scheduled scan đêm không gửi 500 email.
- Heartbeat SSE (comment [[: ping]] mỗi 25 s) để NPM/Cloud LB không cắt; client EventSource tự reconnect — nhưng thêm jitter ở client nếu triển khai bằng fetch stream.
- Gắn với sự cố #1/#9: sự kiện "scan hoàn tất" không tới trong khung giờ kỳ vọng cũng là tín hiệu cho alert no-success (bài B14) — cùng một bảng t_user_events phục vụ cả realtime lẫn giám sát.
`,
  quiz: [
    { t: 'mc', q: 'Dashboard chỉ cần nhận tiến trình và thông báo từ server, không gửi gì ngoài request REST thông thường. Lựa chọn hợp lý nhất?', o: ['SSE: một chiều, HTTP thuần, tự reconnect với Last-Event-ID, dễ qua proxy', 'WebSocket vì nhanh nhất', 'Long polling mỗi 1 giây', 'Push notification FCM cho web'], a: 0, why: 'Một chiều thì SSE đơn giản hơn về ops; WebSocket chỉ khi client cũng cần gửi nhiều.' },
    { t: 'mc', q: 'Trong kiến trúc WebSocket gateway nhiều node, làm sao một worker gửi sự kiện tới user X đang kết nối ở node bất kỳ?', o: ['Worker gửi tới mọi node, node nào có X thì chuyển', 'Worker ghi vào DB và client polling', 'LB sticky session đảm bảo X luôn ở node 1', 'Worker publish lên pub/sub theo channel của X; node đang giữ kết nối của X đã subscribe channel đó (registry trong Redis cho biết ai ở đâu)'], a: 3, why: 'Pub/sub + registry tách worker khỏi topology gateway; broadcast tới mọi node không scale theo số node.' },
    { t: 'mc', q: 'Vì sao sự kiện nên được persist với sequence number trước khi publish lên pub/sub?', o: ['Để pub/sub nhanh hơn', 'Vì pub/sub có thể mất hoặc lộn thứ tự message; store là chân lý để client dedup theo seq và lấp lỗ khi reconnect', 'Vì Redis yêu cầu seq', 'Để giảm kích thước payload'], a: 1, why: 'Pub/sub chỉ là tín hiệu; không có store thì mất tín hiệu là mất dữ liệu.' },
    { t: 'mc', q: 'Một tài khoản có 10 triệu follower đăng bài. Chiến lược fan-out phù hợp?', o: ['Fan-out on write: ghi vào 10 triệu inbox', 'Gửi push notification cho toàn bộ follower', 'Fan-out on read: ghi 1 lần, follower gom lúc đọc; kết hợp hybrid với người dùng thường', 'Không fan-out, chỉ cache bài viết'], a: 2, why: 'Ghi 10 triệu dòng mỗi post không khả thi; hybrid dùng fan-out on write cho người thường, on read cho celebrity.' },
    { t: 'mc', q: 'Sau khi một gateway node chết, 20 000 client reconnect ngay lập tức và làm node kế tiếp quá tải. Thiếu gì?', o: ['Sticky session', 'Dùng WebSocket thay vì SSE', 'Tăng TTL của registry', 'Exponential backoff với jitter ở client (và heartbeat để phát hiện sớm)'], a: 3, why: 'Jitter trải reconnect theo thời gian, tránh thundering herd.' },
    { t: 'fill', q: 'Điền: header mà client SSE gửi khi reconnect để server replay từ sự kiện cuối đã nhận là ___.', a: ['last-event-id', 'last event id', 'last_event_id'], why: 'Tương đương cơ chế last_seq trong WebSocket; server replay từ store.' },
    { t: 'fill', q: 'Điền: tham số của APNs/FCM cho phép gộp nhiều thông báo cùng loại thành một trên thiết bị gọi là ___ key (FCM) hay thread-id (APNs).', a: ['collapse', 'collapse key', 'collapse_key'], why: 'Tránh 5 banner cho 5 scan; payload ≤ 4 KB chỉ chứa tóm tắt và id.' },
    { t: 'open', q: 'Interviewer: "Design real-time notifications for a web dashboard with 100k concurrent users across many servers. How do you route events, handle reconnects, and reach users who are offline?" Trả lời 4–6 câu.', a: 'Dùng SSE (hoặc WebSocket nếu cần hai chiều) qua một tầng gateway mỏng tách khỏi nghiệp vụ; mỗi node giữ ~20–50k kết nối, registry user-to-node trong Redis với TTL gia hạn bằng heartbeat 30 giây. Sự kiện được persist vào store với sequence per user trước, rồi publish lên pub/sub theo channel user/tenant; gateway đang giữ kết nối subscribe và đẩy xuống. Client giữ last seq, dedup và khi reconnect gửi Last-Event-ID để replay từ store; reconnect dùng backoff với jitter. Fan-out on write cho nhóm nhỏ, channel chung cho broadcast. Nếu user không có kết nối, đưa vào hàng đợi push (APNs/FCM/email/Slack) với collapse key và rate limit, dọn token chết theo phản hồi của provider.', keys: ['gateway', 'registry', 'pub/sub', 'sequence', 'reconnect'] }
  ]
},
];
