/* ===== Tab Job: OTS Full-stack — J7–J10: chọn & mô hình hoá DB, CI/CD + GCP, design pattern TS, NFR/sự cố/Agile ===== */
window.LESSONS_J3 = [
{ id: 'J7', type: 'job', topic: 'db', title: 'SQL, MongoDB, Redis, Cassandra: chọn và mô hình hoá cho nghiệp vụ hãng tàu', time: '120 phút',
  goal: 'Với mỗi luồng nghiệp vụ hãng tàu (booking, B/L, track & trace, lịch tàu), chọn đúng DB theo access pattern, viết được schema/key và nêu trade-off giao dịch, consistency, chi phí xoá trong 5 phút.',
  md: `
### Vấn đề cần giải
JD của OTS ghi rõ "SQL và NoSQL (MongoDB, Redis, Cassandra)". Người phỏng vấn sẽ không hỏi "MongoDB là gì" mà hỏi: **dữ liệu X của hãng tàu để ở đâu, key là gì, query nào chạy nhiều nhất, vì sao không dùng DB kia**. Câu trả lời senior luôn bắt đầu từ **access pattern** (ai đọc/ghi gì, bao nhiêu lần mỗi giây, cần consistency mức nào, giữ bao lâu), không bắt đầu từ DB mình thích. Bạn đã chạy Postgres, MongoDB, Redis thật trong hệ SBOM; Cassandra là mảnh phải học mới, và nó khác SQL nhiều nhất.

### Bản đồ nghiệp vụ → DB
| Nghiệp vụ | Access pattern chính | DB hợp | Lý do cốt lõi |
|---|---|---|---|
| Booking, B/L, invoice, công nợ | ghi nhiều bảng trong 1 giao dịch, số booking unique, báo cáo JOIN | Postgres/MySQL | ACID, constraint, SQL ad-hoc |
| EDI đã parse, hồ sơ hàng (cargo, hàng nguy hiểm DG, cài đặt reefer) | đọc/ghi nguyên khối, cấu trúc khác nhau theo đối tác | MongoDB | document lồng nhau, index field con |
| Lịch tàu, session, rate limit, lock | đọc rất nhiều, có TTL, cần dưới 1 ms | Redis | in-memory, cấu trúc dữ liệu sẵn |
| Sự kiện track & trace, telemetry reefer | ghi append khối lượng lớn, đọc "sự kiện mới nhất của container X" | Cassandra | LSM ghi rẻ, scale ngang, đọc theo partition |
> Quy mô giả định: 3 triệu container × ~20 sự kiện/tháng ≈ 60 triệu sự kiện/tháng ≈ 25 ghi/s trung bình — Postgres partition theo tháng vẫn gánh được. Cassandra đáng giá khi cộng telemetry reefer (giả định 500k reefer × 96 bản ghi/ngày ≈ 48 triệu dòng/ngày ≈ 550 ghi/s, đỉnh gấp vài lần), cần multi-region active-active, hoặc giữ nhiều năm. Nói được ngưỡng này là điểm cộng lớn.

### Postgres/MySQL: booking và B/L cần giao dịch
Giữ chỗ là bài toán **không bán quá sức chứa**: tạo booking và trừ TEU (đơn vị container 20 feet) phải cùng một transaction, số booking/B/L phải unique, tiền phải chính xác.
~~~sql
CREATE TABLE booking (
  id          uuid PRIMARY KEY,
  booking_no  text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customer(id),
  voyage_id   uuid NOT NULL REFERENCES voyage(id),
  status      text NOT NULL CHECK (status IN ('REQUESTED','CONFIRMED','CANCELLED')),
  freight_usd numeric(12,2) NOT NULL,      -- tiền: numeric, không float
  version     int NOT NULL DEFAULT 0       -- optimistic locking
);
-- cùng transaction với INSERT booking: 0 dòng cập nhật = hết chỗ → rollback
UPDATE voyage_capacity SET teu_left = teu_left - $1
WHERE voyage_id = $2 AND teu_left >= $1;
~~~
Điều kiện [[teu_left >= $1]] nằm ngay trong UPDATE nên atomic ở cấp dòng, không cần SELECT FOR UPDATE riêng. Lưu thời gian bằng [[timestamptz]] (UTC); giờ địa phương của cảng chỉ là dữ liệu hiển thị — ETA lệch múi giờ là bug kinh điển của ngành.

### MongoDB: tài liệu linh hoạt, nhưng có giá
| Câu hỏi | Embed | Reference |
|---|---|---|
| Luôn đọc cùng nhau? | có: cargo lines trong shipment | không: khách hàng dùng chung cho nhiều shipment |
| Số phần tử con | ít, có giới hạn | tăng không giới hạn (sự kiện, log) |
| Ghi | 1 lệnh atomic trên 1 document | nhiều document, cần transaction nếu phải khớp nhau |
| Giới hạn | document tối đa 16 MB | thêm round trip hoặc [[$lookup]] |
- **Compound index** theo quy tắc ESR: field so sánh bằng (Equality) trước, rồi field Sort, rồi field Range. Query "message của đối tác A trong 7 ngày, mới nhất trước" → index [[{ partnerCode: 1, receivedAt: -1 }]].
- **Aggregation pipeline** thay cho GROUP BY:
~~~ts
await db.collection('edi_messages').aggregate([
  { $match: { partnerCode: 'PARTNER_A', receivedAt: { $gte: since } } },
  { $group: { _id: '$messageType', total: { $sum: 1 }, failed: { $sum: { $cond: ['$parseError', 1, 0] } } } },
  { $sort: { failed: -1 } },
]).toArray();
~~~
- **Transaction đa document** có từ 4.0 (replica set) và 4.2 (sharded), nhưng trả giá: latency cao hơn, giữ lock, mặc định sống tối đa 60 s, phải tự retry khi WriteConflict. Cần nó thường xuyên = dữ liệu đó thuộc về SQL, hoặc ranh giới document chưa đúng.

### Redis: nhanh, nhưng không phải nguồn chân lý
| Nhu cầu | Cấu trúc/lệnh | Lưu ý |
|---|---|---|
| Cache lịch tàu theo cảng | String/Hash, cache-aside, TTL 5–15 phút | xoá key khi lịch đổi; TTL có jitter để không hết hạn đồng loạt |
| Session customer portal | Hash + TTL trượt | mất Redis = khách đăng nhập lại, chấp nhận được |
| Rate limit API đối tác | [[INCR]] + [[EXPIRE]] (fixed window) hoặc sorted set (sliding window) | key theo partner + phút |
| Lock: 1 worker gửi thông báo | [[SET key token NX PX 30000]], nhả bằng Lua so token | không an toàn tuyệt đối khi failover; tính đúng chỗ/tiền dựa vào constraint DB |
| Tàu sắp cập cảng | sorted set, score = epoch ETA | [[ZRANGEBYSCORE]] theo khoảng thời gian |
~~~ts
await redis.zadd('port:VNSGN:eta', etaEpochSec, voyageId);               // cập nhật khi ETA đổi
const next24h = await redis.zrangebyscore('port:VNSGN:eta', now, now + 86400);
if (await redis.set('lock:eta-notify:' + voyageId, token, 'PX', 30000, 'NX') !== 'OK') return; // worker khác đang gửi
~~~
### Cassandra: chuỗi sự kiện container
Cassandra là **query-first design**: viết query trước, mỗi query một bảng, dữ liệu denormalize (ghi lặp sang nhiều bảng). Không JOIN, không lọc tuỳ ý: WHERE phải đủ partition key rồi tới clustering key theo thứ tự.
~~~sql
-- CQL: "20 sự kiện mới nhất của container X tháng này" = đọc đúng 1 partition
CREATE TABLE container_events_by_month (
  container_id text,
  month        text,          -- bucket '2026-10': partition không phình vô hạn
  event_time   timestamp,
  event_id     timeuuid,
  event_type   text,          -- GATE_IN, LOADED, DEPARTED, ARRIVED, DISCHARGED, GATE_OUT
  location     text,          -- UN/LOCODE, vd VNSGN
  PRIMARY KEY ((container_id, month), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id DESC)
  AND default_time_to_live = 63072000;   -- 2 năm, thay cho DELETE
SELECT * FROM container_events_by_month WHERE container_id = 'ONEU1234567' AND month = '2026-10' LIMIT 20;
~~~
- Ops cần "mọi container của chuyến V tại cảng P"? Tạo bảng thứ hai partition theo [[(voyage_code, port)]] và ghi cả hai bảng (idempotent theo event_id). Đó là giá của denormalize.
- Partition nên dưới ~100 MB (rule of thumb phổ biến). Đổi lại, bucket theo tháng khiến tìm "sự kiện cuối cùng" có thể phải lùi sang tháng trước.
- **Consistency level** chọn theo từng query: RF = 3, ghi QUORUM + đọc QUORUM (2 + 2 > 3) thì luôn đọc thấy bản ghi mới nhất; telemetry chấp nhận ONE để latency thấp; multi-DC dùng LOCAL_QUORUM.
- **Tombstone**: DELETE không xoá ngay mà ghi marker, giữ tới hết [[gc_grace_seconds]] (mặc định 10 ngày). Đọc quét qua nhiều tombstone sẽ chậm; mặc định cảnh báo ở 1 000 và huỷ query ở 100 000. Time-series dùng TTL + TimeWindowCompactionStrategy: dữ liệu hết hạn cũng thành tombstone nhưng cả SSTable được bỏ nguyên khối, rất rẻ.
### So sánh nhanh 4 DB
| Tiêu chí | Postgres | MongoDB | Redis | Cassandra |
|---|---|---|---|---|
| Giao dịch | ACID đầy đủ | atomic 1 document; đa document có nhưng đắt | MULTI/Lua trong 1 shard | lightweight transaction (Paxos) đắt, không ACID đa partition |
| Query | SQL, JOIN ad-hoc | filter, aggregation, [[$lookup]] hạn chế | theo key | theo partition + clustering key |
| Scale ghi | dọc, partition bảng; sharding khó | shard theo shard key | cluster 16 384 hash slot | ngang gần tuyến tính, leaderless |
| Không dùng khi | ghi hàng chục nghìn/s liên tục trên 1 node | cần JOIN và giao dịch thường xuyên | dữ liệu không được phép mất | query chưa biết trước |
### ORM trong Node và bẫy N+1
**Prisma** (type-safe, [[include]] tách query bằng IN nên không N+1 nhưng dễ kéo quá nhiều dòng), **TypeORM** (entity decorator, lazy relation dễ sinh N+1, không bao giờ bật [[synchronize: true]] ở prod), **Mongoose** (schema + validation cho MongoDB, [[lean()]] khi chỉ đọc để nhanh và đỡ RAM).
~~~ts
// N+1: 1 query lấy booking + N query lấy line
const bookings = await bookingRepo.find({ where: { customerId } });
for (const b of bookings) b.lines = await lineRepo.find({ where: { bookingId: b.id } });
// Sửa: số query cố định, có giới hạn
const rows = await prisma.booking.findMany({
  where: { customerId }, include: { lines: true }, take: 50, orderBy: { createdAt: 'desc' },
});
~~~
Mặt ngược của N+1 là eager load quá tay: Preload 490k dòng × 10 goroutine từng làm worker SBOM OOM 5 GiB. Quy tắc giống nhau ở mọi ngôn ngữ: chọn đúng field, phân trang keyset, giới hạn song song, đếm số query mỗi request trong test.

### Migration an toàn: expand → migrate → contract
Rolling deploy nghĩa là bản cũ và bản mới chạy **cùng lúc** trên một schema. Đổi tên cột [[ref]] thành [[shipper_ref]] phải chia nhiều release: **expand** (thêm cột nullable, index CONCURRENTLY, code ghi cả hai cột) → **migrate** (backfill theo lô nhỏ, theo dõi replication lag) → **switch** (đọc cột mới qua một chu kỳ release) → **contract** (bỏ ghi cột cũ, release sau mới DROP).
~~~sql
SET lock_timeout = '3s';                        -- không xếp hàng chặn cả bảng
ALTER TABLE booking ADD COLUMN shipper_ref text;
CREATE INDEX CONCURRENTLY idx_booking_shipper_ref ON booking (shipper_ref);  -- ngoài transaction
UPDATE booking SET shipper_ref = ref
WHERE id IN (SELECT id FROM booking WHERE shipper_ref IS NULL LIMIT 5000);    -- lặp đến hết
~~~
Kiểm tra mọi thứ "nhìn" schema: view, FDW (sự cố FDW đóng băng schema → 500 "column does not exist"), ETL, báo cáo BI.

### Sai lầm hay gặp
- Chọn MongoDB cho booking/tiền "vì schema linh hoạt", rồi tự viết lại unique, FK, giao dịch trong code.
- Embed mảng sự kiện tăng vô hạn vào document container → chạm 16 MB, mỗi lần thêm là ghi lại document lớn.
- Thiết kế Cassandra như SQL: bảng chuẩn hoá, [[ALLOW FILTERING]] (quét cả cluster), xoá từng dòng → tombstone.
- Coi Redis là nguồn chân lý, không TTL, không maxmemory-policy → đầy RAM, eviction xoá key quan trọng.
- Dùng lock Redis để đảm bảo không overbook thay vì điều kiện trong câu UPDATE.
- Đổi tên/xoá cột trong 1 bước khi rolling deploy → bản cũ đang chạy trả 500.

### Nói thế nào trong phỏng vấn (EN)
- "I start from access patterns, not from the database I like: who reads what, how often, and how fresh it must be." — Bắt đầu từ access pattern, không từ DB yêu thích.
- "Bookings and B/Ls stay in Postgres, because capacity reservation and unique B/L numbers need real transactions." — Booking và B/L cần giao dịch thật nên ở Postgres.
- "For tracking events I'd partition by container and month and cluster by event time descending, so the latest events are a single-partition read." — Partition theo container + tháng, clustering theo thời gian giảm dần.
- "In Cassandra I avoid row deletes and rely on TTL with time-window compaction, because tombstones hurt reads." — Tránh DELETE, dùng TTL + TWCS.
- "We change schemas with expand and contract, so old and new versions can run side by side during a rolling deploy." — Đổi schema theo expand–contract để hai phiên bản chạy song song.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện index (Postgres):** bảng policy violation 9,6 triệu dòng chỉ có index PK + vòng eval 238 policy → DB 4 vCPU ghim 100%, 55% request 500. Kể theo khung triệu chứng → EXPLAIN → index → số trước/sau; thêm vụ partial index cho 696k dòng pending đưa query từ phút xuống ms.
- **Câu chuyện ORM:** Preload 490k dòng × 10 goroutine → OOM 5 GiB. Dịch sang Node: "Prisma include không có take/select cũng hỏng y như vậy" — chứng tỏ bạn hiểu bản chất, không phụ thuộc ngôn ngữ.
- **Câu chuyện migration:** FDW đóng băng schema remote → 500 sau khi thêm cột. Bài học: migration là một phần của deploy, phải expand–contract và liệt kê mọi thứ phụ thuộc schema.
- **Redis:** Lambda mất REDIS_HOST → fallback localhost → enrichment pending kẹt hàng giờ. Câu chốt: "cache được phép miss, nhưng không được hỏng im lặng".
- **MongoDB:** chỉ kể đúng phần bạn đã đụng trong SBOM; nói rõ khi nào bạn sẽ không chọn Mongo (booking, tiền).
- **Cassandra (chưa có kinh nghiệm):** nói thật, rồi chứng minh bằng bài luyện: [[docker run cassandra:5.0]], tạo bảng container_events_by_month, ghi 1 triệu sự kiện giả bằng script Node ([[cassandra-driver]]), bật [[TRACING ON]] trong cqlsh xem đọc 1 partition, thử DELETE hàng loạt để thấy cảnh báo tombstone.
- **Luyện trong dcn_toolbox:** thêm module booking giả bằng Prisma, bật log query, viết test đếm số query của 1 request (bắt N+1); làm 1 migration đổi tên cột theo expand–contract.
- Tập vẽ bảng "nghiệp vụ → DB" trong 3 phút và nói được ngưỡng khi nào Postgres vẫn đủ, khi nào mới cần Cassandra.
`,
  quiz: [
    { t: 'mc', q: 'Query chính: "20 sự kiện mới nhất của container X". Primary key Cassandra nào hợp nhất?', o: ['PRIMARY KEY (event_id) kèm secondary index trên container_id', 'PRIMARY KEY ((container_id, month), event_time, event_id) với CLUSTERING ORDER BY (event_time DESC)', 'PRIMARY KEY ((event_type), container_id, event_time)', 'PRIMARY KEY ((month), container_id, event_time)'], a: 1, why: 'Partition (container_id, month) gom sự kiện 1 container vào partition có giới hạn, clustering DESC trả mới nhất trước: đọc đúng 1 partition. Partition theo month hay event_type tạo hot partition khổng lồ.' },
    { t: 'mc', q: 'Bạn embed mảng events vào document container trong MongoDB, mỗi sự kiện push thêm 1 phần tử. Sau 1 năm vấn đề lớn nhất là gì?', o: ['MongoDB không index được field nằm trong mảng', 'Push vào mảng làm mất tính atomic của thao tác trên 1 document', 'Mảng bị giới hạn cứng 1 000 phần tử', 'Document phình dần tới giới hạn 16 MB, đọc ghi ngày càng nặng; nên tách collection events hoặc dùng bucket pattern'], a: 3, why: 'Mảng tăng không giới hạn là tín hiệu phải reference/bucket. MongoDB vẫn có multikey index và thao tác trên 1 document vẫn atomic.' },
    { t: 'mc', q: 'Cần đảm bảo chỉ 1 worker gửi thông báo ETA cho một voyage. Cách lấy lock Redis nào đúng?', o: ['SET key token NX PX 30000; khi nhả lock dùng Lua so token rồi mới DEL', 'SETNX key 1 rồi gọi EXPIRE key 30 bằng lệnh thứ hai', 'GET key, nếu rỗng thì SET key token', 'INCR key, giá trị 1 nghĩa là có lock, không cần TTL'], a: 0, why: 'SET NX PX là 1 lệnh atomic có TTL; so token khi nhả tránh xoá lock của worker khác. SETNX + EXPIRE tách rời: crash giữa 2 lệnh là lock vĩnh viễn; GET rồi SET có race.' },
    { t: 'mc', q: 'Cassandra RF = 3. Tổ hợp consistency level nào đảm bảo lần đọc thấy bản ghi vừa ghi thành công?', o: ['Ghi ONE, đọc ONE', 'Ghi ONE, đọc QUORUM', 'Ghi QUORUM, đọc QUORUM', 'Ghi QUORUM, đọc ONE'], a: 2, why: 'Cần R + W > RF: 2 + 2 = 4 > 3 nên tập replica đọc và ghi luôn giao nhau. ONE + QUORUM = 3, không lớn hơn RF.' },
    { t: 'mc', q: 'Service NestJS chạy rolling deploy 3 instance, cần đổi tên cột ref thành shipper_ref. Cách nào không gây lỗi?', o: ['ALTER TABLE RENAME COLUMN chạy ngay trước khi deploy bản mới', 'Thêm shipper_ref và ghi cả hai cột, backfill theo lô, chuyển đọc sang cột mới, release sau mới DROP ref', 'Deploy code đọc shipper_ref trước, migration đổi tên chạy sau', 'Đổi tên trong một transaction để rollback được nếu có lỗi'], a: 1, why: 'Trong lúc rolling deploy bản cũ và mới cùng chạy; chỉ expand–contract giữ schema tương thích với cả hai. Transaction không cứu được instance cũ đang đọc tên cột cũ.' },
    { t: 'fill', q: 'Lấy 50 booking rồi chạy thêm 50 query riêng để lấy booking_line cho từng booking là lỗi ___ query.', a: ['n+1', 'n + 1', 'n+1 query'], why: 'Sửa bằng include/JOIN/IN (số query cố định) hoặc DataLoader khi dùng GraphQL.' },
    { t: 'fill', q: 'Trong Cassandra, DELETE không xoá dữ liệu ngay mà ghi một marker gọi là ___, tồn tại đến hết gc_grace_seconds.', a: ['tombstone', 'tombstones'], why: 'Nhiều tombstone làm đọc chậm và có thể bị huỷ query; time-series nên dùng TTL + TWCS.' },
    { t: 'open', q: 'Interviewer: "Design the storage for container track and trace. Customers look up events by container number, operations look up all containers of a voyage." Bạn chọn DB nào, key thế nào, trade-off gì?', a: 'Chọn Cassandra (hoặc Postgres partition theo tháng nếu quy mô chỉ vài chục ghi/s) vì ghi append khối lượng lớn và đọc theo container. Bảng 1: partition key (container_id, month), clustering event_time DESC → "sự kiện mới nhất" là đọc 1 partition. Bảng 2 cho ops: partition (voyage_code, port); denormalize bằng cách ghi cả hai bảng, idempotent theo event_id. Dữ liệu khách xem dùng QUORUM ghi và đọc với RF = 3; telemetry dùng ONE. Không DELETE từng dòng mà dùng TTL + TimeWindowCompactionStrategy để tránh tombstone. Trade-off: không JOIN, mỗi query mới cần bảng mới, bucket tháng khiến tìm sự kiện cuối có thể phải đọc tháng trước.', keys: ['partition key', 'clustering', 'denormalize', 'QUORUM', 'TTL'] }
  ]
},
{ id: 'J8', type: 'job', topic: 'devops', title: 'CI/CD, Docker và GCP cho người quen AWS', time: '120 phút',
  goal: 'Trình bày được pipeline CI/CD 8 bước cho service NestJS/Next.js, viết Dockerfile multi-stage non-root, ánh xạ 13 dịch vụ AWS sang GCP và lập luận khi nào Cloud Run là đủ, kể cả cách cấu hình secret và rollback.',
  md: `
### Vấn đề cần giải
JD yêu cầu "xây và duy trì CI/CD", ưu tiên GCP và Docker. Bạn quen docker-compose + Watchtower trên EC2 và AWS Lambda — và đã trả giá cho kiểu deploy không có cổng kiểm soát: Watchtower tự kéo [[mongo:latest]] làm crash vì kernel host cũ; redeploy 30 s làm gocron lỡ tick; Lambda mất [[REDIS_HOST]]/[[RABBITMQ_*]] sau redeploy; FE image bake [[localhost]] làm 500 toàn site. CI/CD tốt biến deploy thành việc **nhàm chán**: mọi thay đổi đi cùng một đường, qua các cổng tự động, build một lần, lùi lại được trong vài giây.

### Pipeline chuẩn
| Bước | Công cụ Node/TS | Chặn được gì | Ngân sách thời gian |
|---|---|---|---|
| Lint + format | ESLint, Prettier [[--check]] | lỗi hiển nhiên, cãi nhau về style trong review | dưới 1 phút |
| Type-check | [[tsc --noEmit]] ([[next build]] cũng type-check) | sai kiểu, field undefined | 1–2 phút |
| Unit | Jest/Vitest, coverage phần domain | logic tính phí, parser EDI | 1–3 phút |
| Build image | [[docker buildx]] có cache layer, tag = commit SHA | build không tái lập | 2–4 phút |
| Integration/e2e | Supertest + Testcontainers (Postgres, Redis), Playwright cho FE | query sai, migration hỏng, luồng booking gãy | 3–8 phút |
| Scan | [[npm audit --omit=dev]], Trivy (image), gitleaks (secret) | CVE Critical, key lộ trong repo | 1–2 phút |
| Staging + smoke | deploy, gọi [[/healthz]] và 3–5 API chính | thiếu config, env sai, lỗi mạng kiểu hairpin | 2–3 phút |
| Prod | approval + canary 5–10% rồi 100% | lỗi chỉ lộ với traffic thật | theo dõi 10–30 phút |
Rule of thumb: phản hồi cho PR (ba bước đầu) dưới 10 phút, chậm hơn là dev bắt đầu lờ CI.
~~~yaml
# .github/workflows/api.yml — không có key JSON: xác thực GCP bằng OIDC
on: { push: { branches: [main] }, pull_request: {} }
permissions: { contents: read, id-token: write }
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci && npm run lint && npx tsc --noEmit && npm test -- --ci
  deploy:                                  # staging + smoke tương tự, lược cho gọn
    needs: ci
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production                # required reviewers = cổng approval
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/123456/locations/global/workloadIdentityPools/github/providers/repo
          service_account: deployer@my-proj.iam.gserviceaccount.com
      - uses: google-github-actions/setup-gcloud@v2
      - run: |
          IMG=asia-southeast1-docker.pkg.dev/my-proj/apps/api:$GITHUB_SHA
          gcloud builds submit --tag $IMG
          gcloud run deploy api --image $IMG --region asia-southeast1 --no-traffic --tag canary
          gcloud run services update-traffic api --region asia-southeast1 --to-tags canary=10
~~~
### Dockerfile multi-stage cho NestJS và Next.js
~~~dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# non-root: user node có sẵn trong image chính thức
USER node
CMD ["node", "dist/main.js"]
~~~
- Layer [[npm ci]] chỉ build lại khi lockfile đổi; ở prod pin base image theo digest ([[node:22-alpine@sha256:...]]). Gọi [[node]] trực tiếp (không qua [[npm start]]) để process nhận SIGTERM; bật [[app.enableShutdownHooks()]] trong Nest để đóng pool DB, consumer gọn gàng khi bị scale down.
- **Next.js**: [[output: 'standalone']] trong next.config → chỉ copy [[.next/standalone]], [[.next/static]], [[public]] sang stage runtime, chạy [[node server.js]]; image nhỏ hơn nhiều so với mang cả node_modules. Nhớ: [[NEXT_PUBLIC_*]] bị **inline vào bundle lúc build** — đổi env runtime vô dụng với code phía client (đúng sự cố endpoint OTel bake [[localhost]]).
- [[.dockerignore]] tối thiểu: [[node_modules]], [[.git]], [[.env*]], [[dist]], [[coverage]] — build context nhỏ, không lỡ COPY secret vào layer.
### Chiến lược deploy và rollback
| Chiến lược | Cách làm | Ưu | Nhược |
|---|---|---|---|
| Rolling | thay dần instance cũ bằng mới | không tốn thêm hạ tầng | hai phiên bản chạy song song → schema phải tương thích; rollback = deploy lại, chậm |
| Blue-green | dựng đủ môi trường mới rồi chuyển toàn bộ traffic | rollback tức thì bằng chuyển lại | gấp đôi tài nguyên lúc chuyển; DB dùng chung vẫn phải tương thích |
| Canary | 5–10% traffic vào bản mới, so error rate/p95 rồi tăng | lỗi chỉ chạm ít khách | cần metric tách theo phiên bản và tiêu chí dừng rõ |
Trên Cloud Run mỗi deploy tạo một **revision bất biến** (gắn với image digest), rollback là [[gcloud run services update-traffic api --to-revisions api-00041-abc=100]], mất vài giây. Nhưng rollback code không rollback DB: migration phải expand–contract để bản cũ vẫn chạy được.
### Ánh xạ AWS → GCP
| AWS | GCP | Khác biệt cần nói |
|---|---|---|
| EC2 | Compute Engine | Managed Instance Group tương đương Auto Scaling Group |
| ECS/Fargate | Cloud Run | không có cluster/task definition; scale theo request, về 0 được |
| EKS | GKE | Autopilot: Google quản node, trả tiền theo pod |
| Lambda | Cloud Run functions (tên mới của Cloud Functions) | một instance nhận được nhiều request đồng thời |
| RDS/Aurora | Cloud SQL / AlloyDB | AlloyDB gần Aurora: Postgres tương thích, tách compute/storage |
| ElastiCache | Memorystore | Redis, Valkey, Memcached |
| SQS/SNS | Pub/Sub | topic + subscription gộp vai fan-out và hàng đợi; thứ tự bằng ordering key; có dead-letter topic |
| S3 | Cloud Storage | storage class, lifecycle tương tự |
| CloudWatch | Cloud Logging + Cloud Monitoring (+ Cloud Trace) | stdout của Cloud Run vào thẳng Logging |
| Secrets Manager | Secret Manager | có version; gắn làm env hoặc file vào Cloud Run |
| IAM role | service account | workload chạy dưới danh nghĩa service account |
| ECR | Artifact Registry | đặt cleanup policy để không trả tiền image cũ |
| CodeBuild | Cloud Build | cloudbuild.yaml, trigger theo repo |
Khác biệt khái niệm: **project** của GCP là ranh giới tương đương AWS account; **VPC của GCP là global** (subnet theo region), VPC của AWS theo region.
### Cloud Run khi nào là đủ
| Tham số | Mặc định / giới hạn | Gợi ý cho API NestJS |
|---|---|---|
| concurrency | 80 request/instance, tối đa 1000 | Node I/O-bound giữ 80; endpoint nặng CPU thì giảm |
| min instances | 0 (scale to zero) | 1–2 cho API khách dùng để tránh cold start, đổi lại trả tiền idle |
| max instances | 100 | chọn sao cho max instances × pool size ≤ max_connections của Cloud SQL |
| cold start | vài trăm ms tới vài giây | bundle nhỏ, lazy import, startup CPU boost; Nest nhiều module khởi tạo DI chậm hơn |
| request timeout | 300 s, tối đa 60 phút | việc dài hơn chuyển sang Cloud Run jobs hoặc Pub/Sub + worker |
| CPU | mặc định chỉ cấp khi đang xử lý request | việc nền sau khi trả response bị bóp CPU → instance-based billing hoặc đẩy sang Cloud Tasks/Pub/Sub |
Không đủ khi cần process nền chạy liên tục có state, mạng/sidecar phức tạp, hoặc traffic đều 24/7 khiến GKE/VM rẻ hơn. Lịch định kỳ dùng **Cloud Scheduler** gọi endpoint/job, không bao giờ cron in-memory: bài học gocron + redeploy lỡ tick còn tệ hơn trên Cloud Run, nơi instance có thể về 0 hoặc có 10 bản cùng chạy.
### Danh tính, cấu hình, quan sát, chi phí
- **Service account riêng mỗi service**, quyền tối thiểu ([[roles/cloudsql.client]], [[roles/secretmanager.secretAccessor]]); không chạy bằng default compute service account (thường có quyền Editor cả project).
- **Workload Identity**: workload lấy token ngắn hạn qua metadata server; CI ngoài GCP dùng Workload Identity Federation (OIDC) như YAML trên; GKE map Kubernetes service account sang IAM. Không còn key JSON nào để lộ.
- **Secret Manager**: [[gcloud run deploy api --set-secrets DB_PASSWORD=db-password:3]] — pin version để rollback được; config thường để trong file khai báo service (service.yaml/Terraform) được review như code. Image không mang env của môi trường nào → cùng digest chạy ở staging và prod.
- **Fail fast** thay vì fallback âm thầm (bài học Lambda mất env rồi dùng localhost). Container không khởi động được thì revision mới không nhận traffic, bản cũ vẫn phục vụ:
~~~ts
const required = ['DATABASE_URL', 'REDIS_HOST', 'PUBSUB_TOPIC'] as const;
const missing = required.filter((k) => !process.env[k]);
if (missing.length) throw new Error('Missing env: ' + missing.join(', ') + ' (refuse to start)');
~~~
- **Log JSON một dòng ra stdout**: Cloud Logging tự hiểu [[severity]], [[message]] và [[logging.googleapis.com/trace]] để nối log với trace (pino + formatter đổi level thành severity). Trace bằng OpenTelemetry SDK → Cloud Trace; alert theo tỉ lệ 5xx và p95.
- **Chi phí cơ bản**: Cloud Run tính vCPU-giây + GiB-giây + số request (có free tier); min instances = trả tiền idle; egress internet/liên region tính tiền; Cloud Logging miễn phí 50 GiB/project/tháng rồi tính theo GiB — log debug ồ ạt thành hoá đơn.

### Sai lầm hay gặp
- Tag [[latest]] hoặc tag trôi, GitHub Action không pin version/SHA → build hôm nay khác hôm qua.
- Bake secret/URL môi trường vào image (file .env bị COPY vì thiếu .dockerignore); chạy root; image 1 GB vì mang devDependencies.
- Dùng default compute service account, hoặc dán key JSON vào secret CI.
- Max instances không giới hạn × pool 10 kết nối → vượt max_connections Cloud SQL khi traffic đột biến.
- Pipeline xanh nhưng không có smoke test → "deploy thành công" mà site trả 500.
- Rollback code trong khi migration không tương thích ngược → rollback cũng vỡ.

### Nói thế nào trong phỏng vấn (EN)
- "Every change goes through the same pipeline: lint, type-check, unit tests, build once, integration tests, a security scan, staging with smoke tests, then a gated canary." — Mọi thay đổi đi cùng một pipeline có cổng.
- "We build the image once, tag it with the commit SHA and promote the same digest; configuration comes from Secret Manager at runtime." — Build một lần, đẩy cùng digest, config lấy lúc runtime.
- "On GCP I'd start with Cloud Run and move to GKE only when we need long-running stateful workloads or fine-grained networking." — Bắt đầu bằng Cloud Run, chỉ lên GKE khi thật cần.
- "CI authenticates with Workload Identity Federation, so there are no long-lived keys to leak." — CI xác thực bằng WIF, không có key sống lâu.
- "A redeploy once silently dropped environment variables on our Lambda; since then I want services to fail fast on missing config." — Bài học mất env: service phải fail fast.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện "vì sao cần pipeline":** hệ SBOM deploy bằng docker-compose + Watchtower, nhanh nhưng không có cổng: mongo:latest crash (→ pin digest), redeploy lỡ tick gocron (→ lịch nằm ngoài process), Lambda mất env (→ config khai báo + fail fast), FE bake localhost (→ build once, config runtime). Bốn sự cố, bốn cổng — câu trả lời mạnh cho "How would you set up CI/CD?".
- **Chuyển từ AWS sang GCP:** nói thẳng "AWS là nền của tôi", rồi đọc bảng ánh xạ và nhấn 3 khác biệt: project, VPC global, service account thay IAM role.
- **Next.js:** kể việc bạn gặp NEXT_PUBLIC bị inline lúc build khi xử lý FE dự án, và hiểu output standalone khi nâng next 16.
- **Luyện 1:** Dockerfile multi-stage cho 1 service NestJS trong dcn_toolbox; ghi size trước/sau ([[docker images]]), kiểm tra [[docker run --rm img id]] không phải root, [[docker stop]] xem app có graceful shutdown không.
- **Luyện 2:** GitHub Actions cho repo luyện: lint + tsc + Jest + Testcontainers + build image + Trivy; đo tổng thời gian, ép phản hồi PR dưới 10 phút.
- **Luyện 3:** tạo project GCP (free trial), deploy 1 service lên Cloud Run bằng gcloud với service account riêng và secret từ Secret Manager; so cold start min-instances 0 và 1; rollback bằng update-traffic.
- Chuẩn bị câu trả lời 2 phút "Walk me through your ideal pipeline" theo bảng 8 bước, kết bằng cách rollback.
`,
  quiz: [
    { t: 'mc', q: 'FE Next.js trên Cloud Run: bạn sửa env NEXT_PUBLIC_API_URL của service rồi deploy lại cùng image, nhưng trình duyệt vẫn gọi localhost. Nguyên nhân?', o: ['Cloud Run cache env của revision cũ đến 24 giờ', 'Trình duyệt cache DNS của localhost', 'NEXT_PUBLIC_* được inline vào bundle JS lúc next build, đổi env runtime không ảnh hưởng code phía client', 'Thiếu output standalone nên Next không đọc được process.env'], a: 2, why: 'Biến NEXT_PUBLIC_ bị thay bằng hằng số khi build. Muốn build once deploy many, giá trị phía client phải được đọc lúc runtime (server component, endpoint config).' },
    { t: 'mc', q: 'API NestJS trên Cloud Run trả 202 rồi mới gửi email ETA trong cùng process; email gửi rất chậm hoặc mất. Nguyên nhân khả dĩ nhất?', o: ['Mặc định Cloud Run chỉ cấp CPU khi đang xử lý request; việc nền sau response bị bóp CPU và instance có thể bị thu hồi', 'Concurrency 80 làm event loop quá tải', 'Cloud Run không cho kết nối ra ngoài nếu chưa có VPC connector', 'Request timeout 300 s cắt mất tác vụ nền'], a: 0, why: 'Request-based billing chỉ cấp CPU trong vòng đời request. Dùng instance-based billing hoặc đẩy việc sang Cloud Tasks/Pub/Sub.' },
    { t: 'mc', q: 'Trên AWS, app chạy EC2 lấy quyền qua IAM role (instance profile). Trên GCP, cách tương đương đúng nhất là?', o: ['Tạo key JSON cho service account và lưu trong Secret Manager', 'Tạo API key và truyền qua biến môi trường', 'Dùng tài khoản Google của dev có quyền Owner', 'Gắn service account quyền tối thiểu vào Cloud Run/VM; app lấy token ngắn hạn qua metadata server'], a: 3, why: 'Service account gắn vào workload là tương đương IAM role: không có bí mật dài hạn nào phải cất giữ.' },
    { t: 'mc', q: 'Bạn cần rollback gần như tức thì mà không phải build hay deploy lại, chấp nhận tạm thời gấp đôi tài nguyên. Chiến lược nào hợp?', o: ['Rolling update', 'Blue-green', 'Recreate (tắt hết rồi bật bản mới)', 'Chạy lại pipeline với tag trước đó'], a: 1, why: 'Blue-green giữ nguyên môi trường cũ, rollback chỉ là chuyển traffic lại. Rolling và chạy lại pipeline đều phải deploy lại.' },
    { t: 'mc', q: 'Dockerfile NestJS nào tận dụng layer cache tốt nhất khi bạn chỉ sửa code trong src?', o: ['COPY . . rồi RUN npm ci rồi RUN npm run build', 'RUN npm ci ở stage runtime để luôn có dependency mới nhất', 'COPY package.json và package-lock.json, RUN npm ci, rồi mới COPY . . và build', 'COPY package*.json rồi RUN npm install không dùng lockfile cho nhanh'], a: 2, why: 'Layer npm ci chỉ bị vô hiệu khi lockfile đổi; COPY . . trước sẽ cài lại dependency mỗi lần sửa code. Bỏ lockfile làm build không tái lập.' },
    { t: 'fill', q: 'GitHub Actions xác thực vào GCP bằng OIDC token ngắn hạn, không cần key JSON, nhờ Workload Identity ___.', a: ['federation'], why: 'Workload Identity Federation đổi token OIDC của CI lấy credential GCP ngắn hạn.' },
    { t: 'fill', q: 'Build image một lần rồi đẩy đúng cùng một image ___ (sha256:...) qua staging và prod, không build lại.', a: ['digest', 'image digest'], why: 'Tag có thể bị ghi đè, digest thì bất biến: staging và prod chạy đúng cùng một artifact.' },
    { t: 'open', q: 'Interviewer: "Set up CI/CD for a NestJS API on Cloud Run from scratch. How do you make releases safe, and how do you roll back?" Trả lời 4–6 câu.', a: 'PR chạy lint, tsc --noEmit, unit test; sau đó build image một lần, tag commit SHA, chạy integration test bằng Testcontainers và scan Trivy/npm audit rồi push digest lên Artifact Registry. Merge vào main thì deploy cùng digest đó lên staging và chạy smoke test vài API chính. Prod cần approval: deploy revision mới không nhận traffic, canary 10%, so error rate và p95 rồi mới lên 100%. Rollback là update-traffic về revision cũ trong vài giây; migration luôn expand–contract nên code cũ vẫn chạy được. Config và secret lấy từ Secret Manager lúc runtime, CI xác thực bằng Workload Identity Federation, service fail fast nếu thiếu env.', keys: ['digest', 'staging', 'smoke', 'canary', 'Secret Manager'] }
  ]
},
{ id: 'J9', type: 'job', topic: 'design', title: 'Nguyên lý lập trình, design pattern và code có tài liệu trong TypeScript', time: '120 phút',
  goal: 'Giải thích SOLID bằng code NestJS, viết nhanh 6–8 pattern hay hỏi bằng TS với ví dụ hãng tàu, nhận diện anti-pattern khi review, và trả lời câu "pattern bạn dùng gần đây" bằng ví dụ thật trong 90 giây.',
  md: `
### Vấn đề cần giải
JD ghi "code có tài liệu, theo good practice, nguyên lý lập trình và design pattern". Người phỏng vấn hỏi pattern không để nghe lại định nghĩa GoF, mà để xem bạn có nhận ra **lực kéo** (force) trong code thật: chỗ nào hay đổi, chỗ nào phải thay được khi test, phụ thuộc bên ngoài nào không tin được. Pattern đúng chỗ giảm chi phí thay đổi; sai chỗ chỉ thêm tầng gián tiếp. Go đã dạy bạn interface nhỏ và composition — TS/NestJS dùng y như vậy, cộng thêm DI container và decorator.

### SOLID trong NestJS
| Nguyên lý | Một câu | Ví dụ hãng tàu / Nest | Dấu hiệu vi phạm |
|---|---|---|---|
| S — Single Responsibility | một lý do để thay đổi | BookingService không tự tính phí, gửi email, sinh PDF B/L | service 2 000 dòng, 15 dependency |
| O — Open/Closed | thêm hành vi bằng code mới, không sửa code cũ | thêm phụ phí = thêm một rule Strategy | [[switch (surchargeType)]] lặp ở 5 nơi |
| L — Liskov Substitution | lớp con thay được lớp cha mà không phá hợp đồng | mọi ScheduleProvider đều trả ETA theo UTC | lớp con ném "not supported" hoặc đổi đơn vị |
| I — Interface Segregation | interface nhỏ theo nhu cầu người gọi | ScheduleReader tách khỏi ScheduleWriter | phải mock 20 method để test 1 |
| D — Dependency Inversion | phụ thuộc abstraction, nhận qua DI | QuoteService nhận FxRateProvider qua token | [[new HttpClient()]] trong constructor, import thẳng SDK |
~~~ts
export interface FxRateProvider { rate(from: string, to: string): Promise<number>; }
export const FX_RATE = Symbol('FX_RATE');   // interface biến mất lúc runtime → cần token
@Module({ providers: [{ provide: FX_RATE, useClass: BankFxRateProvider }, QuoteService] })
export class PricingModule {}
@Injectable() export class QuoteService {
  constructor(@Inject(FX_RATE) private readonly fx: FxRateProvider) {}
}
// test: Test.createTestingModule({ providers: [QuoteService, { provide: FX_RATE, useValue: { rate: async () => 25000 } }] })
~~~
### DRY, KISS, YAGNI — và khi nào phá luật
- **DRY** là không lặp *tri thức*, không phải không lặp dòng code. Validate booking và validate quote trông giống nhau nhưng đổi vì lý do khác nhau → giữ riêng; gộp sớm tạo coupling. Rule of three: lặp lần thứ ba mới trừu tượng hoá.
- **KISS** là mặc định; **YAGNI**: đừng dựng "plugin system" khi mới có một đối tác EDI.
- Phá luật có chủ đích: copy code giữa hai bounded context để chúng tiến hoá độc lập; viết "xấu" ở hot path khi có số đo hiệu năng chứng minh.
- **Composition over inheritance**: [[ReeferBooking extends Booking extends BaseEntity]] → đổi lớp cha là vỡ lớp con. Thay bằng ghép: Booking có [[ReeferSetting]] tuỳ chọn và các policy được inject.
### Pattern hay hỏi, đặt vào nghiệp vụ hãng tàu
| Pattern | Lực kéo | Ví dụ |
|---|---|---|
| Strategy | thuật toán thay theo ngữ cảnh, thêm mới thường xuyên | phụ phí BAF (nhiên liệu), PSS (mùa cao điểm), THC (phí bến) |
| Factory | tạo đúng đối tượng theo dữ liệu đầu vào | parser EDI theo đối tác + định dạng (EDIFACT, X12, JSON) |
| Adapter | API bên ngoài khác mô hình của mình | API lịch tàu của đối tác/cảng → port nội bộ VesselSchedulePort |
| Observer | nhiều bên quan tâm một thay đổi | ETA đổi → báo khách, xoá cache, ghi audit |
| Decorator | thêm hành vi cắt ngang, không sửa hàm | [[@UseGuards]], [[@UseInterceptors]], cache, đo thời gian |
| Repository | tách truy cập dữ liệu khỏi domain | BookingRepository: Postgres ở prod, in-memory trong test |
| Unit of Work | nhiều thay đổi commit cùng lúc | booking + trừ capacity + outbox trong 1 transaction |
| Builder | đối tượng nhiều trường, nhiều bước, kiểm tra ở cuối | B/L: shipper, consignee, notify party, cargo lines |
| Circuit breaker | phụ thuộc chập chờn kéo sập mình | API cảng timeout → mở mạch, trả lịch từ cache |
| Retry | lỗi tạm thời (timeout, 503) | exponential backoff + jitter, chỉ cho thao tác idempotent |
~~~ts
// Strategy: thêm phụ phí = thêm rule, QuoteService nhận mảng rule qua DI (useFactory)
interface SurchargeRule { code: string; applies(q: Quote): boolean; amountUsd(q: Quote): number; }
const PSS: SurchargeRule = { code: 'PSS', applies: (q) => inPeakSeason(q.etd), amountUsd: (q) => q.teu * q.pssPerTeu };
const lines = rules.filter((r) => r.applies(q)).map((r) => ({ code: r.code, usd: r.amountUsd(q) }));
// Factory: chọn parser theo đối tác + định dạng, không đoán mò
const parsers: Record<string, () => EdiParser> = { 'PARTNER_A:EDIFACT': () => new IftminParser('D99B'), 'PARTNER_B:JSON': () => new PartnerBJsonParser() };
export function parserFor(partner: string, format: string): EdiParser {
  const make = parsers[partner + ':' + format];
  if (!make) throw new UnsupportedFormatError(partner, format);
  return make();
}
// Adapter: đối tác trả { vsl_cd, eta_lcl: '20261021 0830', tz: '+07' } → mô hình nội bộ (UTC)
class PartnerScheduleAdapter implements VesselSchedulePort {
  constructor(private readonly api: PartnerApiClient) {}
  async getEta(vesselCode: string): Promise<Eta> {
    const r = await this.api.fetchVessel(vesselCode);
    return { vesselCode: r.vsl_cd, etaUtc: toUtc(r.eta_lcl, r.tz) };
  }
}
~~~
- **Observer**: [[@nestjs/event-emitter]] cho [[this.events.emit('eta.changed', evt)]] và [[@OnEvent('eta.changed')]]. Nhưng EventEmitter là in-process: crash là mất. Việc **bắt buộc phải xảy ra** (email báo khách) cần outbox + queue — vụ audit log publish trước commit là ví dụ ngược.
- **Builder** cho B/L: [[BillOfLading.builder().shipper(s).consignee(c).addCargo(line).pol('VNSGN').pod('JPTYO').build()]]; [[build()]] kiểm tra bất biến (ít nhất 1 cargo, POL khác POD) rồi trả object immutable.
- **Circuit breaker + retry** (thư viện opossum hoặc cockatiel):
~~~ts
const breaker = new CircuitBreaker(fetchPortSchedule, { timeout: 3000, errorThresholdPercentage: 50, resetTimeout: 30000 });
breaker.fallback((port: string) => scheduleCache.get(port));   // mạch mở → dữ liệu cache, gắn cờ stale
const schedule = await breaker.fire('VNSGN');
~~~
Retry tối đa 3 lần, backoff 200 → 400 → 800 ms + jitter, chỉ cho lỗi tạm thời và thao tác idempotent; với batch, trả kết quả **theo từng item** — bài học FetchBatch nuốt lỗi khiến một item hỏng kéo hỏng cả batch.
### Anti-pattern hay gặp trong service Nest
| Anti-pattern | Triệu chứng | Cách gỡ |
|---|---|---|
| God service | BookingService 3 000 dòng, inject 20 thứ, PR nào cũng đụng | tách theo use case: CreateBooking, CancelBooking, AmendBooking |
| Anemic domain quá mức | entity chỉ có field, rule "chỉ huỷ khi chưa xếp hàng" chép ở 4 service | đưa bất biến vào entity: [[booking.cancel(now)]] tự kiểm tra trạng thái (CRUD danh mục cảng thì service + DTO là đủ) |
| Util khổng lồ | utils.ts 1 500 dòng ai cũng import | chuyển hàm về cạnh domain dùng nó |
| Pattern cho có | Factory sinh Factory, interface một implementation không vì test hay biên hệ thống | xoá tầng gián tiếp |
### Clean/hexagonal trong Nest: domain không phụ thuộc framework
:::diagram
Controller[HTTP controller] -> UseCase[Use case]
Consumer[Pub/Sub consumer] -> UseCase
UseCase -> Domain[Domain Booking, Voyage]
UseCase -> Port[Port BookingRepo, SchedulePort]
PgRepo[Postgres adapter] -> Port : implements
PartnerApi[Partner API adapter] -> Port : implements
:::
Quy tắc: [[domain/]] là TS thuần, không import [[@nestjs/*]], TypeORM hay SDK; [[application/]] định nghĩa port (interface) và use case; [[infra/]] chứa adapter; module Nest chỉ nối dây (wiring). Lợi: test rule nghiệp vụ không cần boot Nest hay DB, đổi đối tác/DB không đụng domain. Giá: nhiều file hơn — service CRUD nhỏ thì controller → service → repository là đủ.
### Code review checklist
- **Đúng**: edge case (null, rỗng, trùng), múi giờ, làm tròn tiền, idempotency khi retry.
- **Lỗi**: không nuốt lỗi, phân loại tạm thời/vĩnh viễn, message có ngữ cảnh (booking_no, partner).
- **Dữ liệu**: ranh giới transaction, publish sau commit, N+1, index cho query mới, luôn có LIMIT.
- **Bảo mật và test**: validate DTO (class-validator), kiểm tra quyền theo customer, không log PII/secret; có test cho nhánh lỗi, không chỉ happy path.
- **Vận hành và đọc được**: log/metric cho đường mới, migration tương thích ngược; tên nói ý định, comment giải thích *vì sao* chứ không phải *cái gì*.
### Code có tài liệu
| Loại | Cho ai | Tối thiểu phải có |
|---|---|---|
| README | dev mới vào dự án | chạy local trong 15 phút: yêu cầu, env, lệnh dev/test/migrate |
| TSDoc | người gọi hàm, public API | mô tả, [[@param]], [[@returns]], [[@throws]], ví dụ |
| ADR | team một năm sau | bối cảnh, quyết định, phương án bị loại, hệ quả |
| OpenAPI | FE, QA, đối tác | sinh từ code bằng [[@nestjs/swagger]] (bật CLI plugin để tự suy kiểu DTO), có ví dụ và mã lỗi |
| CHANGELOG | QA, khách, vận hành | Keep a Changelog + semver, ghi rõ breaking change |
DTO khai báo [[@ApiProperty({ example: 'VNSGN', description: 'UN/LOCODE cảng xếp hàng' })]] cạnh rule class-validator; controller mô tả cả mã lỗi:
~~~ts
@ApiTags('bookings') @Controller('bookings')
export class BookingController {
  /** Giữ chỗ trên chuyến. Idempotent theo header Idempotency-Key. @throws CapacityExceededError */
  @Post() @ApiCreatedResponse({ type: BookingDto }) @ApiConflictResponse({ description: 'Hết chỗ trên chuyến' })
  create(@Body() dto: CreateBookingDto) { return this.createBooking.execute(dto); }
}
~~~
### Trả lời "Which design pattern did you use recently?"
Khung 90 giây: **lực kéo** (cái gì hay đổi/khó test) → **pattern** → **code nhỏ** (một interface, hai implementation) → **kết quả đo được** → **trade-off** (khi nào không dùng). Ví dụ từ hệ SBOM: nhiều nguồn vulnerability (OSV, NVD, GHSA, EUVD, JVNDB) khác định dạng và lịch đồng bộ → mỗi nguồn một adapter sau cùng interface, pipeline match/policy không biết nguồn nào. Chỉ kể nếu đúng với code bạn đã làm.

### Sai lầm hay gặp
- Đọc thuộc định nghĩa GoF nhưng không có ví dụ nào từ code thật.
- Dùng interface TS làm DI token → bị xoá khi compile, Nest không resolve được; phải dùng Symbol/string token hoặc abstract class.
- Tự viết singleton bằng biến static thay vì để DI quản lý vòng đời → khó test, không ai lo reconnect (đúng kiểu RabbitMQ publisher singleton).
- Retry mọi lỗi, không jitter, retry thao tác không idempotent → tạo booking hai lần; dùng EventEmitter in-process cho việc bắt buộc phải giao (email ETA) → mất khi crash.
- Hexagonal cho service CRUD 3 bảng; ngược lại, nhồi rule nghiệp vụ vào controller.
- Swagger viết tay lệch với code; ADR viết khi đã quên lý do.

### Nói thế nào trong phỏng vấn (EN)
- "I reach for a pattern when I can name the force behind it: surcharges change every season, so each one is a Strategy and the quote service stays closed for modification." — Chỉ dùng pattern khi gọi tên được lực kéo.
- "In TypeScript interfaces disappear at runtime, so in Nest I inject them through a Symbol token or an abstract class." — Interface TS mất lúc runtime nên cần token.
- "I keep the domain free of framework imports, so business rules are unit-tested without booting Nest or a database." — Domain không import framework để test nhanh.
- "Each vulnerability feed sits behind the same adapter interface, so the matching pipeline never knows which source it talks to." — Mỗi nguồn sau một adapter chung.
- "API docs are generated from the code with the Nest Swagger module, and decisions with long-term impact go into ADRs." — Tài liệu API sinh từ code, quyết định lớn ghi ADR.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện pattern thật:** các nguồn vulnerability (OSV, NVD, GHSA, EUVD, JVNDB) sau một interface chung → Adapter + Strategy; kể theo khung 90 giây, nêu con số (thêm một nguồn mất mấy ngày). Chỉ nhận phần bạn thực sự làm.
- **Câu chuyện anti-pattern:** publisher RabbitMQ là singleton không reconnect → mọi cron im lặng nhiều ngày. Dịch sang Nest: để DI container quản lý vòng đời ([[onModuleInit]], [[onApplicationShutdown]]), có reconnect + health check + metric.
- **Câu chuyện retry/batch:** FetchBatch nuốt lỗi, một coordinate hỏng làm hỏng cả batch → retry có phân loại lỗi, kết quả theo từng item, dead-letter cho item lỗi vĩnh viễn.
- **Câu chuyện Unit of Work:** audit log publish trước commit → consumer gặp FK violation, mất log; sửa bằng outbox ghi cùng transaction.
- **Luyện 1:** trong một service NestJS của dcn_toolbox, tìm một [[switch]] theo loại và đổi thành Strategy với DI token; viết unit test không boot Nest.
- **Luyện 2:** bật [[@nestjs/swagger]] (kèm CLI plugin) cho một service, mở [[/docs]]; viết một ADR thật, ví dụ "mỗi service một Postgres schema riêng".
- **Luyện nói:** ba câu trả lời 2 phút bằng tiếng Anh: "a pattern you used recently", "a SOLID violation you fixed", "how you review code".
`,
  quiz: [
    { t: 'mc', q: 'Trong NestJS bạn viết constructor(private readonly fx: FxRateProvider) với FxRateProvider là interface TS, app báo không resolve được dependency. Vì sao?', o: ['Nest yêu cầu mọi provider phải là singleton', 'Thiếu decorator @Injectable() trên interface', 'Interface phải export default mới inject được', 'Interface bị xoá khi compile nên không còn gì làm token lúc runtime; cần Symbol/string token với @Inject hoặc abstract class'], a: 3, why: 'TS xoá type khi compile; Nest resolve theo token runtime (class, Symbol, string).' },
    { t: 'mc', q: 'Mỗi mùa hãng tàu thêm hoặc đổi phụ phí (BAF, PSS, THC...). Bạn muốn thêm phụ phí mà không sửa QuoteService. Kết hợp nào đúng?', o: ['Singleton + Template Method', 'Strategy (mỗi phụ phí một rule inject qua DI) theo nguyên lý Open/Closed', 'Builder theo nguyên lý Liskov', 'Thêm case vào switch trong QuoteService theo nguyên lý DRY'], a: 1, why: 'Mỗi phụ phí là một Strategy; thêm mới bằng code mới, service đóng với sửa đổi.' },
    { t: 'mc', q: 'API lịch tàu của đối tác trả { vsl_cd, eta_lcl, tz } theo giờ địa phương, hệ của bạn dùng mô hình Eta theo UTC. Đặt việc chuyển đổi ở đâu?', o: ['Adapter implement port nội bộ, chuyển định dạng và múi giờ trước khi dữ liệu vào domain', 'Observer phát sự kiện mỗi lần gọi API đối tác', 'Decorator bọc controller để đổi múi giờ lúc trả response', 'Singleton giữ kết nối tới đối tác'], a: 0, why: 'Adapter cô lập mô hình bên ngoài; domain chỉ thấy kiểu nội bộ, đổi đối tác không lan vào trong.' },
    { t: 'mc', q: 'ETA đổi thì phải gửi email cho khách chắc chắn, kể cả khi process crash ngay sau commit. Cách nào đúng?', o: ['EventEmitter in-process emit sau khi commit', 'Publish lên queue trước khi commit để message chắc chắn đi trước', 'Ghi bản ghi outbox trong cùng transaction với thay đổi ETA, relay đọc outbox rồi publish, consumer idempotent', 'Gửi email trực tiếp bên trong transaction DB'], a: 2, why: 'Outbox gắn sự kiện với commit; publish trước commit gây message về dữ liệu chưa tồn tại, EventEmitter mất khi crash.' },
    { t: 'mc', q: 'Chính sách retry nào hợp lý khi gọi API cảng hay timeout?', o: ['Retry vô hạn, mỗi lần cách 1 giây cố định', 'Tối đa 3 lần, exponential backoff + jitter, chỉ cho lỗi tạm thời và thao tác idempotent, kèm circuit breaker', 'Retry ngay lập tức 10 lần để tăng xác suất thành công', 'Không retry, trả 500 cho khách tự thử lại'], a: 1, why: 'Backoff + jitter tránh dồn tải đồng loạt; breaker ngắt khi đối tác chết hẳn; retry thao tác không idempotent gây ghi trùng.' },
    { t: 'fill', q: 'Trong hexagonal architecture, interface do application/domain định nghĩa để adapter bên ngoài cắm vào gọi là ___.', a: ['port', 'ports'], why: 'Ports and adapters: port là hợp đồng phía trong, adapter là implementation phía ngoài.' },
    { t: 'fill', q: 'Tài liệu ngắn ghi bối cảnh, quyết định, phương án bị loại và hệ quả của một quyết định kiến trúc gọi là ___.', a: ['adr', 'architecture decision record', 'architecture decision records'], why: 'ADR giữ lại lý do, thứ mà code không thể hiện được.' },
    { t: 'open', q: 'Interviewer: "Tell me about a design pattern you used recently, and why." Trả lời 4–6 câu theo khung lực kéo → pattern → kết quả → trade-off.', a: 'Hệ SBOM của tôi lấy vulnerability từ nhiều nguồn (OSV, NVD, GHSA...) khác định dạng và lịch đồng bộ; lực kéo là nguồn mới xuất hiện thường xuyên và mỗi nguồn hỏng theo kiểu riêng. Tôi đặt mỗi nguồn sau một Adapter implement cùng một interface (fetch, normalize); pipeline match và policy chỉ biết interface đó, chọn implementation theo cấu hình như Strategy. Kết quả: thêm nguồn mới là thêm một adapter cùng test riêng bằng fixture, không gọi mạng và không đụng pipeline. Trade-off: thêm một tầng gián tiếp và phải giữ interface ổn định; nếu chỉ có một nguồn thì tôi không làm vậy.', keys: ['Adapter', 'interface', 'test', 'trade-off'] }
  ]
},
{ id: 'J10', type: 'job', topic: 'behavioral', title: 'NFR, xử lý sự cố, technical backlog và làm việc Agile', time: '120 phút',
  goal: 'Biến NFR mơ hồ thành chỉ tiêu đo được, chạy được playbook 30 phút đầu khi API Node chậm, viết ticket nợ kỹ thuật có acceptance criteria, và kể 3 câu chuyện sự cố/ước lượng/feedback theo khung có số liệu.',
  md: `
### Vấn đề cần giải
Nửa JD là việc ngoài code: phát triển NFR, xử lý sự cố nhanh, giúp lead định nghĩa technical backlog, roadmap, quản lý rủi ro, feedback cho đồng đội, giao tiếp với đối tác. Vòng behavioral kiểm tra ba điều: bạn có biến mơ hồ thành **đo được** không, có **bình tĩnh và có thứ tự** khi production cháy không, có dám nói **"tôi chưa chắc"** đúng lúc không. Bạn có lợi thế hiếm: nhiều sự cố production thật với khách Nhật — chỉ cần kể có cấu trúc và có số.

### NFR → yêu cầu đo được
| NFR mơ hồ | Chỉ tiêu đo được (giả định cho customer portal) | Đo/kiểm bằng |
|---|---|---|
| "Phải nhanh" | p95 [[GET /bookings/:id]] dưới 300 ms, p99 dưới 1 s ở 200 RPS | k6 ở staging, histogram latency theo route |
| "Luôn chạy" | SLO availability 99,9%/30 ngày cho tra cứu tracking | tỉ lệ request không 5xx, uptime check |
| "An toàn" | checklist OWASP Top 10: kiểm tra quyền theo customer (Broken Access Control), không secret trong repo, không CVE Critical | review, SAST, [[npm audit]], gitleaks |
| "Tin cậy" | thông báo ETA tới khách trong 15 phút ở 99% trường hợp; không mất message | lag từ lúc ETA đổi tới lúc gửi, kích thước DLQ |
| "Dễ bảo trì" | coverage domain ≥ 80%, PR dưới 400 dòng, CI dưới 10 phút, MTTR dưới 1 giờ | số liệu CI, Sonar, thống kê sự cố |
Downtime được phép mỗi 30 ngày: 99% ≈ 7,2 giờ; 99,9% ≈ 43 phút; 99,95% ≈ 22 phút; 99,99% ≈ 4,3 phút. Phần 0,1% đó là **error budget**: đốt hết thì tạm dừng feature, dồn sức cho reliability — đây là cách NFR thành công cụ thương lượng với PO.

### Quy trình xử lý sự cố
:::diagram
Detect[Phát hiện qua alert hoặc khách báo] -> Triage[Khoanh vùng phạm vi và mức độ]
Triage -> Mitigate[Giảm nhẹ trước]
Mitigate -> Comms[Báo trạng thái định kỳ]
Mitigate -> RootFix[Sửa gốc sau]
RootFix -> PM[Postmortem không đổ lỗi]
PM -> Backlog[Action item vào backlog]
:::
- **Khoanh vùng**: endpoint nào, mọi khách hay một nhóm, từ mấy giờ, trùng deploy/config change/sự kiện hạ tầng nào. Gán mức độ (vd SEV1: khách không booking được; SEV3: báo cáo nội bộ chậm).
- **Giảm nhẹ trước, sửa gốc sau**: rollback, tắt feature flag, scale, chặn traffic xấu, chuyển sang dữ liệu cache. Rollback trong 5 phút luôn thắng debug 2 giờ khi khách đang lỗi.
- **Vai trò**: một người điều phối (incident commander), người xử lý, người giao tiếp — sự cố nhỏ thì một người kiêm, nhưng vẫn ghi timeline.
- **Giao tiếp**: cập nhật theo nhịp cố định (vd 30 phút), kể cả khi "chưa có gì mới"; tách rõ sự thật và giả thuyết.
- **Postmortem**: timeline, tác động có số (bao nhiêu khách, bao lâu, bao nhiêu request lỗi), root cause bằng 5 whys, điều làm tốt/chưa tốt, action item có owner + hạn. Blameless: hỏi "hệ thống nào để lỗi này lọt", không hỏi "ai làm".
~~~
[Sự cố] 10:20 — Tra cứu tracking chậm: p95 8 s (bình thường 0,4 s), ~30% request timeout.
Ảnh hưởng: customer portal, từ 09:55. Booking và B/L không bị ảnh hưởng.
Đã làm: 10:15 rollback bản 2.3.1, latency đang giảm, tiếp tục theo dõi.
Cập nhật tiếp theo: 10:50.
~~~

### Playbook 30 phút đầu khi API Node chậm
| Phút | Kiểm tra | Tín hiệu | Nếu đúng thì |
|---|---|---|---|
| 0–5 | phạm vi + thay đổi gần nhất | p95 theo route, theo instance; lịch sử deploy/config | trùng deploy → rollback ngay rồi mới điều tra |
| 5–10 | event loop lag | lag p99 trên 100 ms, một core CPU 100% | code đồng bộ nặng: JSON.parse payload lớn, crypto/bcrypt sync, regex backtracking |
| 10–15 | DB pool + DB | số request chờ pool, query chậm, [[pg_stat_activity]], CPU DB | pool cạn do query chậm, transaction giữ lâu, leak connection, hoặc DB quá tải |
| 15–20 | API ngoài | latency, timeout, trạng thái circuit breaker theo dependency | gọi không có timeout → request treo giữ socket; bật breaker/fallback |
| 20–25 | memory/GC | heap used, RSS tăng dần, số lần restart/OOM | leak (cache không giới hạn, listener không gỡ) hoặc GC pause gây lag |
| 25–30 | quyết định giảm nhẹ | tổng hợp ở trên | rollback, scale, tắt flag, rate limit; ghi timeline, báo trạng thái |
~~~ts
import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {   // histogram tính bằng nanosecond
  logger.info({ eventLoopP99Ms: h.percentile(99) / 1e6, heapUsedMb: process.memoryUsage().heapUsed / 1e6 });
  h.reset();
}, 10000);
~~~
~~~sql
SELECT pid, state, wait_event_type, now() - xact_start AS tx_age, left(query, 80)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY tx_age DESC NULLS LAST LIMIT 10;
~~~
Bài học sự cố pilot: log ngập "conn busy" trông như lỗi pool, nhưng gốc là DB 4 vCPU ghim 100% vì bảng 9,6 triệu dòng thiếu index cộng vòng eval 238 policy. **Đừng dừng ở triệu chứng đầu tiên** — hỏi tiếp "vì sao pool cạn?".

### Technical backlog: biến nợ kỹ thuật thành việc được ưu tiên
Nợ kỹ thuật chỉ được ưu tiên khi nói bằng ngôn ngữ của PO: **tác động = tần suất × chi phí mỗi lần** (giờ dev, thời gian khách bị lỗi, rủi ro bảo mật). Xếp hạng theo (khả năng × tác động) / chi phí sửa:
| Nợ (ví dụ, điểm giả định) | Khả năng 1–5 | Tác động 1–5 | Chi phí (ngày) | Điểm |
|---|---|---|---|---|
| Bảng violation lớn thiếu index | 5 | 4 | 0,5 | 40 |
| Publisher không reconnect sau khi broker restart | 4 | 5 | 1 | 20 |
| Next.js có CVE RCE, cần nâng bản vá | 3 | 5 | 1 | 15 |
| Lịch chạy in-memory, không leader election | 3 | 3 | 5 | 1,8 |
~~~
Tiêu đề: Publisher RabbitMQ tự reconnect sau khi broker restart
Bối cảnh: broker bị recreate → mọi cron job im lặng nhiều ngày, không có alert.
Acceptance criteria:
- Restart broker ở staging: publish thành công trở lại trong 30 s, không restart app.
- Có metric publish_errors_total và alert khi lớn hơn 0 trong 5 phút.
- Test integration (Testcontainers) dừng rồi bật lại broker, message không mất.
Ngoài phạm vi: chuyển sang outbox (ticket riêng).
~~~

### Ước lượng, rủi ro, roadmap
- **Story point** đo độ phức tạp tương đối, dùng velocity của team để dự báo; **giờ/ngày công** (khách Nhật hay hỏi theo 人日, người-ngày) cần cho hợp đồng. Dùng cả hai, nhưng đừng quy đổi point ra giờ cố định.
- Chia việc tới mức 1–2 ngày; việc lớn hơn nghĩa là chưa hiểu đủ. Ước lượng ba điểm: lạc quan O, khả dĩ M, bi quan P → PERT [[(O + 4M + P) / 6]], báo dạng khoảng (vd 3–5 ngày, 80% tự tin).
- Chưa rõ thì nói thẳng: "Tôi chưa chắc, cần spike 1 ngày đọc tài liệu EDI của đối tác rồi ước lượng lại." Spike phải timebox và có đầu ra: ước lượng mới + danh sách rủi ro.
| Rủi ro | Khả năng | Tác động | Giảm nhẹ | Owner |
|---|---|---|---|---|
| API đối tác chưa có môi trường test | cao | cao | contract test + mock, xin sandbox từ tuần 1 | lead |
| Migration bảng booking lớn khoá bảng | trung bình | cao | expand–contract, lock_timeout, chạy giờ thấp điểm | dev |
| Chỉ một người hiểu module tính phí | trung bình | trung bình | pair programming, README + ADR | lead |
Roadmap kỹ thuật theo quý, gắn với mục tiêu sản phẩm (vd "thông báo ETA từ 1 giờ xuống 15 phút"), chia Now / Next / Later; mỗi mục có chỉ số đo được.

### Feedback SBI và làm việc với khách Nhật
- **SBI** (Situation – Behavior – Impact) + đề nghị: "Trong review PR booking hôm thứ Ba (S), migration đổi tên cột trong một bước (B); nếu merge, bản đang chạy sẽ trả 500 trong lúc rolling deploy (I). Mình tách theo expand–contract nhé?" Nói về hành vi quan sát được, không về tính cách; khen cũng dùng SBI.
- **Khách Nhật**: 報連相 (hō-ren-sō: báo cáo, liên lạc, bàn bạc) — báo sớm, tin xấu trước, có số và mốc thời gian, tách sự thật khỏi giả thuyết, câu ngắn dễ dịch máy, chốt lại bằng văn bản trên Backlog. Không hứa ngày khi chưa chắc: đưa phương án A/B kèm trade-off để khách chọn.

### Scrum: dev làm gì trong mỗi buổi
| Buổi | Mục đích | Dev đóng góp |
|---|---|---|
| Sprint planning | chọn việc, chốt sprint goal | ước lượng, chia task, nêu phụ thuộc và rủi ro |
| Daily (15 phút) | đồng bộ, gỡ block | hôm qua/hôm nay/đang kẹt; chi tiết bàn riêng sau |
| Backlog refinement | làm rõ story trước khi vào sprint | hỏi acceptance criteria, đề xuất chia nhỏ, chỉ ra NFR và ticket kỹ thuật |
| Sprint review | demo cho stakeholder | demo trên staging, kèm số liệu |
| Retrospective | cải tiến cách làm | 1–2 action có owner, không đổ lỗi |
Definition of Done tối thiểu: code + test + review + tài liệu cập nhật + chạy trên staging + có log/metric.

### Sai lầm hay gặp
- NFR "phải nhanh" không con số → không test được, cãi nhau lúc nghiệm thu.
- Debug root cause khi khách đang lỗi thay vì rollback trước; im lặng suốt sự cố rồi báo khi đã xong.
- Postmortem đổ lỗi cá nhân; action item không owner, không hạn.
- Ticket "refactor module X" không nêu tác động, không acceptance criteria → không bao giờ được ưu tiên.
- Ước lượng một con số cho việc chưa hiểu, không nói rủi ro; quy đổi story point ra giờ.
- Feedback chung chung ("code bạn hơi rối"), hoặc lần đầu nói ra là giữa retro trước cả team.

### Nói thế nào trong phỏng vấn (EN)
- "I turn 'it should be fast' into a target like p95 under 300 ms at 200 requests per second, so we can test it and agree on it." — Biến "phải nhanh" thành chỉ tiêu kiểm được.
- "During an incident I mitigate first, by rolling back or switching the feature off, and dig into the root cause once customers are safe." — Giảm nhẹ trước, tìm gốc sau.
- "The logs said the pool was exhausted, but the real cause was the database pinned at 100% CPU by a missing index; I learned not to stop at the first symptom." — Không dừng ở triệu chứng đầu tiên.
- "I'm not confident in this estimate yet; give me a one-day spike and I'll come back with a range and the main risks." — Xin spike thay vì đoán.
- "I frame tech debt by impact: how often it hurts, how much each time, and what it costs to fix." — Nói nợ kỹ thuật bằng tác động.
- "When I give feedback I describe the situation, the behavior and its impact, then suggest a concrete next step." — Feedback theo SBI kèm đề nghị.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện sự cố chính (STAR):** pilot 55% request 500 — S: khách báo lỗi diện rộng; T: khôi phục rồi tìm gốc; A: thấy "conn busy" nhưng không dừng ở đó → DB 4 vCPU ghim 100% → bảng violation 9,6 triệu dòng chỉ có PK + 238 policy eval liên tục; R: số trước/sau + action item. Kết bằng điều bạn đã đổi trong quy trình.
- **Câu chuyện silent failure:** publisher RabbitMQ không reconnect → cron im lặng nhiều ngày. Bài học NFR: alert theo "lần chạy thành công gần nhất" (heartbeat), không chỉ theo lỗi.
- **Câu chuyện giao tiếp với khách Nhật:** một ticket trên Backlog bạn báo sớm, có timeline, số liệu, phương án A/B (ví dụ vụ Last Scanned đứng yên).
- **Câu chuyện nợ kỹ thuật:** partial index cho bảng pending tạo tay trên Canary nhưng chưa có trong migration → ticket kỹ thuật có acceptance criteria để không mất khi dựng môi trường mới.
- **Câu chuyện ước lượng:** chọn một ticket bạn ước lượng sai, kể vì sao và giờ bạn chia nhỏ/spike thế nào.
- **Luyện 1:** viết sẵn 5 câu chuyện STAR bằng tiếng Anh (sự cố, xung đột, feedback, ước lượng sai, cải tiến quy trình), mỗi câu dưới 2 phút, ghi âm nghe lại.
- **Luyện 2:** viết postmortem 1 trang cho vụ publisher theo khung ở trên; viết bảng NFR cho dcn_toolbox (p95, SLO, checklist bảo mật).
- **Luyện 3:** trong một service NestJS của dcn_toolbox, thêm metric event loop lag + số request chờ pool; chèn một vòng lặp đồng bộ nặng và xem playbook bắt được trong mấy phút.
`,
  quiz: [
    { t: 'mc', q: 'SLO availability 99,9% theo cửa sổ 30 ngày cho phép tổng thời gian lỗi khoảng bao nhiêu?', o: ['4,3 phút', '43 phút', '7,2 giờ', '8,8 giờ'], a: 1, why: '0,1% × 30 × 24 × 60 ≈ 43 phút. 8,8 giờ là 99,9% tính theo năm; 7,2 giờ là 99% theo 30 ngày.' },
    { t: 'mc', q: 'API tra cứu tracking chậm hẳn từ 15 phút trước, đúng lúc vừa deploy bản mới. Việc đầu tiên nên làm?', o: ['Profile CPU trên prod để tìm hàm chậm', 'Đọc diff của bản mới để tìm nguyên nhân', 'Rollback về bản trước, báo trạng thái, rồi mới điều tra root cause', 'Tăng gấp đôi số instance và chờ xem'], a: 2, why: 'Thời điểm trùng deploy là tín hiệu mạnh; giảm nhẹ trước để khách hết lỗi, điều tra sau trên staging hoặc bằng log.' },
    { t: 'mc', q: 'API Node: event loop lag p99 500 ms, một core CPU 100%, DB và API ngoài bình thường. Nguyên nhân khả dĩ nhất?', o: ['Code đồng bộ nặng trên main thread: JSON.parse payload lớn, crypto sync, regex backtracking', 'DB pool bị cạn kết nối', 'API đối tác trả chậm', 'Mất gói tin giữa load balancer và instance'], a: 0, why: 'I/O chậm không chặn event loop, chỉ làm request chờ; lag cao kèm CPU 100% là dấu hiệu tính toán đồng bộ hoặc GC.' },
    { t: 'mc', q: 'Ticket nợ kỹ thuật nào dễ được PO ưu tiên nhất?', o: ['"Refactor BookingService cho sạch hơn"', '"Nâng toàn bộ dependency lên bản mới nhất"', '"Viết lại module tính phí theo kiến trúc hexagonal"', '"Publisher không reconnect đã gây cron im lặng nhiều ngày; fix 1 ngày; AC: restart broker ở staging, publish lại trong 30 s, có alert"'], a: 3, why: 'Ticket nêu tác động đã xảy ra, chi phí sửa và acceptance criteria kiểm được; các ticket còn lại không nói vì sao phải làm bây giờ.' },
    { t: 'mc', q: 'Câu feedback nào đúng khung SBI?', o: ['"Code của bạn hơi rối, cần cẩn thận hơn."', '"Trong PR hôm thứ Ba, migration đổi tên cột trong một bước; khi rolling deploy bản cũ sẽ trả 500. Mình tách expand–contract nhé?"', '"Bạn luôn quên viết test."', '"Team mình cần chất lượng cao hơn, mọi người chú ý nhé."'], a: 1, why: 'Có tình huống cụ thể, hành vi quan sát được, tác động và đề nghị; các câu khác chung chung hoặc phán xét con người.' },
    { t: 'fill', q: 'Khung feedback ___ gồm Situation – Behavior – Impact.', a: ['sbi'], why: 'SBI giữ feedback ở hành vi quan sát được và tác động, không chạm vào tính cách.' },
    { t: 'fill', q: 'Phần lỗi còn được phép trong kỳ SLO (vd 0,1% với SLO 99,9%) gọi là error ___.', a: ['budget', 'error budget'], why: 'Error budget cân bằng tốc độ ra feature và độ tin cậy: hết budget thì ưu tiên reliability.' },
    { t: 'open', q: 'Interviewer: "Tell me about a production incident you handled." Trả lời theo STAR trong 4–6 câu.', a: 'Situation: môi trường pilot của khách Nhật có 55% request trả 500 — nêu impact bằng số thật: bao nhiêu người dùng, kéo dài bao lâu. Task: khôi phục dịch vụ trước, tìm gốc sau, và báo trạng thái cho khách theo nhịp cố định. Action: log ngập "conn busy" nhưng tôi không dừng ở pool; CPU DB 4 vCPU ghim 100%, pg_stat_activity cho thấy query trên bảng violation 9,6 triệu dòng chỉ có index PK, bị vòng eval 238 policy gọi liên tục. Tôi mitigate trước (ví dụ giảm song song của vòng eval để DB thở lại), rồi sửa root cause bằng index đúng cho query đó. Result: tỉ lệ lỗi về bình thường (nêu số trước/sau); postmortem blameless với action item có owner: index vào migration, alert CPU DB và p95, load test với bảng lớn.', keys: ['impact', 'mitigate', 'root cause', 'postmortem', 'action item'] }
  ]
}
];
