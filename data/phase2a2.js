/* ===== Giai đoạn 2 · Khối xây dựng (tiếp, B6–B10): consensus & điều phối, giao dịch phân tán, broker & streaming, rate limiting, ID & thời gian ===== */
window.LESSONS_B1B = [
{ id: 'B6', type: 'block', topic: 'consistency', title: 'Consensus và điều phối: Raft, etcd/ZooKeeper, distributed lock, leader election, lease, fencing token', time: '130 phút',
  goal: 'Giải thích được Raft (term, election, log replication, commit index, 2f+1) trong 3 phút; chọn đúng cơ chế lock/leader election cho job scheduler nhiều instance và nói rõ vì sao Redis lock không đủ cho correctness nếu thiếu fencing token.',
  md: `
### Vấn đề cần giải
Một service chạy 3 instance cho khỏi single point of failure, nhưng có việc chỉ được **một** instance làm: chạy scheduled scan lúc 02:00, gửi digest, rebuild index, cấp số thứ tự. Đã có nhiều máy thì phải **thỏa thuận**: ai làm, config hiện tại là gì, ai đang giữ lock. Thỏa thuận này khó vì ba thứ không tin được: **mạng** (partition, trễ không giới hạn), **process** (GC stop-the-world, VM bị pause, swap, SIGSTOP) và **đồng hồ** (NTP nhảy, drift vài chục ms mỗi ngày). Consensus (thuật toán để một nhóm node đồng ý một giá trị dù f node chết) là lời giải "đúng"; distributed lock, leader election, lease là các ứng dụng của nó. Sự cố #9 của bạn chính là bài toán này ở dạng nhỏ: gocron in-memory trên nhiều instance, không ai là leader, Watchtower redeploy 30 s làm lỡ tick, lịch không persist nên không ai biết mình đã lỡ.

### Cốt lõi
#### Raft: ba vai, một term, một log
- **Vai**: Follower, Candidate, Leader. **Term** là số nhiệm kỳ tăng đơn điệu, gắn vào mọi message; ai thấy term lớn hơn thì tự hạ xuống follower và cập nhật term.
- **Leader election**: follower không nhận heartbeat trong *election timeout* (ngẫu nhiên 150–300 ms) thì tăng term, thành candidate, gửi RequestVote. Mỗi node chỉ bỏ một phiếu mỗi term, và chỉ bỏ cho candidate có log ít nhất bằng mình (so term của entry cuối, rồi index). Đủ **majority** thì thành leader, gửi heartbeat (AppendEntries rỗng) để chặn bầu cử mới. Timeout ngẫu nhiên để tránh split vote lặp mãi.
- **Log replication**: client gửi lệnh tới leader; leader ghi entry (index, term, lệnh) vào log của mình, gửi AppendEntries song song tới follower. Khi **majority** đã ghi, leader tăng **commit index**, apply vào state machine, trả lời client. Follower biết commit index qua heartbeat kế tiếp và apply theo.
- **Safety**: entry đã commit không bao giờ bị ghi đè; leader mới chắc chắn có mọi entry đã commit (nhờ luật bầu cử ở trên). Leader chỉ commit entry của term hiện tại bằng cách đếm ack; entry của term cũ được commit gián tiếp theo.

:::diagram
Client[Client] -> Leader[Leader term 7] : lệnh x=1
Leader -> F1[Follower 1] : AppendEntries idx 42
Leader -> F2[Follower 2] : AppendEntries idx 42
F1 -> Leader : ack idx 42
Leader -> SM[State machine] : commit idx 42 khi 2/3 đã ghi
Leader -> Client : OK sau 1 RTT tới majority
F2 -> Leader : ack muộn, không cần đợi
:::

#### Vì sao 2f+1, và vì sao 4 node không hơn 3
Chịu được f node chết mà vẫn còn majority thì cần n = 2f + 1. Hai majority bất kỳ của cùng cluster luôn **giao nhau ít nhất 1 node**, nên không thể có hai leader cùng term và entry đã commit không thể biến mất. Cluster 4 node vẫn chỉ chịu được 1 lỗi (majority là 3), tốn thêm 1 máy và tăng độ trễ ghi; vì vậy luôn chọn số lẻ.

| n node | chịu được f lỗi | cần bao nhiêu node ghi để commit | ghi chú |
|---|---|---|---|
| 1 | 0 | 1 | không phải consensus, chỉ là một máy |
| 3 | 1 | 2 | chuẩn cho etcd/ZooKeeper nội bộ |
| 4 | 1 | 3 | lãng phí, đừng chọn |
| 5 | 2 | 3 | control plane quan trọng: chịu 1 node bảo trì + 1 node hỏng |
| 7 | 3 | 4 | hiếm; mỗi write chờ 4 fsync, throughput giảm rõ |

Trả giá: mọi write đi qua một leader (single writer) và chờ **1 RTT tới majority + fsync**: trong một DC ~1–3 ms, trải ba vùng liên lục địa ~100–150 ms. Vì vậy consensus dùng cho **metadata nhỏ, ghi ít**, không phải đường nóng của dữ liệu nghiệp vụ.

#### etcd / ZooKeeper / Consul: kho metadata, không phải database
- Lưu gì: config, service discovery, leader election, lock, membership. etcd mặc định quota 2 GB (khuyến nghị tối đa 8 GB), mỗi value giới hạn ~1,5 MB; vài nghìn tới vài chục nghìn write/s vì mỗi write qua Raft và fsync. Lưu component SBOM hay policy violation vào đây là sai từ gốc.
- Primitive của etcd: key-value có **revision** tăng đơn điệu toàn cục, **lease** (TTL, keepalive; key gắn lease tự xóa khi lease hết), **watch** (stream thay đổi từ một revision), **txn** compare-and-swap. ZooKeeper tương đương: ephemeral znode (mất khi session chết), sequential znode (số thứ tự), watch một lần, ZXID.
- Ai dùng: Kubernetes lưu toàn bộ cluster state trong etcd; Kafka từng phụ thuộc ZooKeeper, nay chạy KRaft (Raft nội bộ) để bớt một hệ thống phải vận hành.

#### Distributed lock: hai mục đích, hai mức an toàn
Kleppmann tách rõ: lock cho **efficiency** (tránh hai worker làm trùng việc; thỉnh thoảng trùng cũng không chết ai) và lock cho **correctness** (hai bên cùng ghi là hỏng dữ liệu). Mức đầu dùng Redis là đủ; mức sau cần fencing.
- **Redis một node**: [[SET lock:job42 TOKEN NX PX 30000]] với TOKEN ngẫu nhiên của người giữ. Nhả bằng Lua: chỉ DEL nếu GET trả đúng token; không DEL mù vì có thể xóa lock của người đến sau. Lock mất khi Redis failover (replication async) hoặc hết TTL trước khi việc xong.
- **Redlock**: acquire trên N = 5 Redis độc lập, thành công nếu được majority trong thời gian nhỏ hơn TTL trừ đi drift. Tranh cãi Kleppmann (2016): (1) không có fencing token nên **process pause** (GC stop-the-world vài giây, page fault, VM migrate) sau khi lấy lock làm TTL hết, người khác lấy lock, process cũ tỉnh dậy vẫn ghi; (2) Redlock giả định đồng hồ các node trôi chậm và không nhảy, nhưng NTP step hoặc admin chỉnh giờ làm key hết hạn sớm. Kết luận thực dụng: Redlock không an toàn hơn Redis đơn một cách có ý nghĩa cho correctness; muốn correctness thì cần fencing.
- **Fencing token**: mỗi lần cấp lock, lock service phát một số **tăng đơn điệu** (etcd revision, ZK zxid, Postgres sequence). Client gửi token kèm mọi lần ghi; storage từ chối token nhỏ hơn token lớn nhất đã thấy. Điều kiện bắt buộc: storage phải kiểm tra được token (với Postgres chỉ cần một cột [[fence_token]] và điều kiện WHERE).

:::diagram
A[Client A] -> Lock[Lock service etcd lease] : acquire
Lock -> A : lease 15 s, token 33
A -> Pause[A bị GC pause 20 s]
Lock -> B[Client B] : lease của A hết hạn, cấp token 34
B -> Store[Storage kiểm tra token] : ghi kèm token 34
Pause -> Store : ghi kèm token 33, bị từ chối
:::

- **Lease và TTL**: lock luôn có hạn (lease), holder phải gia hạn trước khi hết. Quy tắc: TTL bằng khoảng 1,5–3 lần chu kỳ gia hạn (Kubernetes leader election: lease 15 s, renew mỗi 10 s, retry 2 s). TTL ngắn thì failover nhanh nhưng dễ mất lock khi mạng chậm; TTL dài thì khi leader chết mọi người đợi hết TTL. Clock drift: TTL đo bằng đồng hồ server lock, client phải coi lock "hết sớm hơn" một khoảng an toàn (Redlock dùng hệ số drift 1% TTL cộng thời gian acquire).

| Cơ chế | An toàn khi process pause | Fencing token | Vận hành | Dùng cho |
|---|---|---|---|---|
| Redis SET NX PX (1 node) | không | tự làm bằng INCR, không atomic với lock | đã có Redis sẵn | efficiency, dedup job |
| Redlock 5 node | không (Kleppmann) | không | 5 Redis riêng, tốn | hiếm khi đáng |
| etcd lease + revision | có, nếu storage kiểm tra token | có sẵn (revision) | thêm một cluster 3 node | leader election, lock cần correctness |
| ZooKeeper ephemeral + sequential | có, nếu storage kiểm tra token | có sẵn (zxid, sequence) | JVM, nặng vận hành hơn | hệ Hadoop, Kafka cũ |
| Postgres advisory lock | mất connection là mất lock, không có TTL ảo | dùng sequence làm token | không thêm hệ thống mới | hệ nhỏ đã có Postgres |

#### Leader election cho job scheduler: giải sự cố #9 theo tầng
Tình huống: gocron giữ lịch trong RAM của từng instance; 2 instance thì chạy đôi, redeploy đúng lúc tick thì không ai chạy, restart xong không biết lần cuối chạy khi nào.
1. **Persist lịch**: bảng [[jobs(id, cron, next_run_at, last_run_at, locked_by, lock_until)]]. Lúc start đọc bảng; nếu [[next_run_at < now()]] thì chạy bù (catch-up) hoặc bỏ qua theo policy của từng job. Lịch không còn phụ thuộc RAM của một process.
2. **Mutual exclusion bằng chính Postgres**, một trong hai cách. (a) **Advisory lock**: [[pg_try_advisory_lock(hashtext('scheduler'))]] giữ trên một connection dành riêng suốt vòng đời instance; ai lấy được là leader, mất connection thì lock tự nhả sau khi TCP keepalive phát hiện (vài giây tới vài chục giây). (b) **Claim theo hàng**: [[UPDATE jobs SET locked_by = $1, lock_until = now() + interval '5 min' WHERE id = (SELECT id FROM jobs WHERE next_run_at <= now() AND (lock_until IS NULL OR lock_until < now()) ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *]]. Cách (b) cho nhiều instance cùng chạy các job khác nhau, không cần leader.
3. **etcd lease** khi đã có etcd hoặc chạy trên Kubernetes: dùng client-go leaderelection, chỉ leader khởi động scheduler; đổi leader trong vòng TTL.
4. **Idempotent job**: dù có leader, job vẫn phải chịu được chạy hai lần (dedup theo khóa [[job_id + scheduled_at]]), vì fencing hoàn hảo không rẻ.

Postgres advisory lock là "consensus đủ dùng" cho hệ nhỏ: Postgres vốn là single-writer có HA, app chết theo Postgres nên không thêm failure domain mới. Giới hạn phải nhớ: session-level lock gắn với **connection**; qua PgBouncer ở chế độ transaction pooling, connection bị trả về pool sau mỗi câu lệnh nên lock "biến mất" hoặc dính sang session khác. Khi đó dùng transaction-level lock ([[pg_advisory_xact_lock]]) trong một tx dài, hoặc một connection riêng không qua pooler.

### Số liệu cần nhớ
| Con số | Giá trị | Ý nghĩa |
|---|---|---|
| Raft election timeout | 150–300 ms ngẫu nhiên; etcd mặc định heartbeat 100 ms, election 1 000 ms | đổi leader trong ~1–2 s sau khi leader chết |
| Write latency qua Raft | 1 RTT tới majority + fsync: ~1–3 ms trong DC, 100–150 ms liên lục địa | lý do không để dữ liệu nghiệp vụ đi qua consensus |
| etcd dung lượng | quota mặc định 2 GB, khuyến nghị tối đa 8 GB, value ~1,5 MB | kho metadata, không phải DB |
| Kubernetes leader election | lease 15 s, renew 10 s, retry 2 s | TTL phải dài hơn chu kỳ renew một khoảng chịu được mạng chậm |
| Redlock drift factor | 1% TTL + thời gian acquire | phần phải trừ khỏi thời gian hiệu lực của lock |

### Sai lầm hay gặp
- Dùng etcd/ZooKeeper/Consul làm nơi lưu dữ liệu nghiệp vụ hoặc hàng đợi; quota đầy là cả control plane đứng.
- Chọn cluster 4 hoặc 6 node cho "an toàn hơn": không chịu thêm lỗi nào, chỉ thêm độ trễ.
- Nhả lock bằng DEL thẳng, không so token: xóa nhầm lock của người đến sau, hai holder cùng lúc.
- TTL ngắn hơn thời gian việc dài nhất; không gia hạn lease trong khi chạy; hoặc gia hạn từ goroutine bị block bởi chính công việc.
- Coi "đang giữ lock" là bằng chứng an toàn mà không fencing ở storage; quên rằng GC pause hay SIGSTOP có thể dài hơn TTL.
- Advisory lock session-level đi qua PgBouncer transaction pooling, hoặc lấy lock trên một connection rồi ghi dữ liệu trên connection khác.
- Scheduler in-memory trên nhiều instance, không persist [[last_run_at]], không có catch-up: lỡ tick là mất luôn, không log, không alert (sự cố #9).
- Quên rằng leader election chỉ chọn người chạy, không bảo đảm chạy đúng một lần: job vẫn phải idempotent.

### Nói thế nào trong phỏng vấn (EN)
- "Raft needs a majority of 2f+1 nodes to commit, so a 3-node cluster tolerates one failure and a 5-node cluster tolerates two; even-sized clusters buy nothing." — Raft cần majority của 2f+1 node để commit; 3 node chịu 1 lỗi, 5 node chịu 2; số chẵn không được gì thêm.
- "etcd and ZooKeeper are coordination stores for small, rarely written metadata; every write goes through consensus and fsync, so I would never put business data there." — etcd/ZooKeeper là kho điều phối cho metadata nhỏ, ít ghi; mọi write qua consensus và fsync nên không để dữ liệu nghiệp vụ ở đó.
- "A Redis lock is fine for efficiency, but for correctness I need a fencing token that the storage layer checks, because a process can pause longer than the lock TTL." — Redis lock đủ cho efficiency; correctness cần fencing token được storage kiểm tra vì process có thể pause lâu hơn TTL.
- "For a small system that already runs Postgres, an advisory lock or SELECT FOR UPDATE SKIP LOCKED is consensus enough; it adds no new failure domain." — Hệ nhỏ đã có Postgres thì advisory lock hoặc SKIP LOCKED là consensus đủ dùng, không thêm failure domain.
- "Leader election decides who runs the scheduler, not that the job runs exactly once, so the job itself must be idempotent and the schedule must be persisted." — Leader election chọn ai chạy, không bảo đảm chạy đúng một lần; job phải idempotent và lịch phải persist.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #9 là bài toán điều phối chưa được giải: gocron in-memory ở worker, nhiều instance sau scale, Watchtower recreate container trong ~30 s đúng lúc tick. Việc tuần này: thêm bảng [[scheduled_jobs(id, cron, next_run_at, last_run_at, last_status, locked_by, lock_until)]], worker lúc start đọc bảng, mọi tick ghi [[last_run_at]]; lỡ tick quá 1 chu kỳ thì chạy bù và phát metric [[scheduler_missed_ticks_total]].
- Mutual exclusion: không dựng etcd chỉ cho việc này. Dùng [[pg_try_advisory_lock]] trên một [[*sql.Conn]] dành riêng (không qua pool) để chọn leader scheduler; hoặc đổi hẳn sang claim từng job bằng [[FOR UPDATE SKIP LOCKED]] để mọi worker cùng kéo job, không cần leader. Kiểm tra trước: worker có đi qua PgBouncer transaction pooling không; nếu có thì advisory lock session-level sẽ hỏng.
- Sweeper enrichment (sự cố #8) hiện cũng là "nhiều instance cùng quét 100 dòng cũ nhất": chuyển sang claim hàng bằng SKIP LOCKED + cột [[claimed_until]], mỗi instance lấy batch riêng, zombie không chặn nhau.
- Fencing cho write-back: Lambda enrichment ghi kết quả vào PRCL/t_components sau khi chạy có thể tới 15 phút; một lần re-import giữa chừng tạo ra "người giữ mới". Thêm [[enrich_epoch]] vào hàng và điều kiện [[WHERE enrich_epoch = $expected]] khi ghi; kết quả cũ tới muộn tự bị từ chối thay vì ghi đè (liên hệ sự cố #14 về ghi đè không có scope).
- Redis lock hiện có (nếu dùng cho dedup job): kiểm tra ba điều: có token riêng không, nhả bằng Lua so token không, TTL có dài hơn job dài nhất không. Nếu job dựa vào Redis lock để không chạy đôi mà Redis trên Lambda từng mất env (sự cố #2) thì lock đang im lặng không hoạt động: cần alert khi acquire lỗi thay vì fallback "cứ chạy".
- ADR nên viết: "Điều phối job trong SBOM: Postgres là nguồn chân lý cho lịch + advisory lock/SKIP LOCKED; không thêm etcd/ZooKeeper cho tới khi có hơn 3 hệ cần leader election". Ghi rõ cách đo: số tick lỡ mỗi tuần, số lần chạy đôi (dedup theo [[job_id + scheduled_at]]).
- Nếu vẫn giữ gocron: chỉ khởi động nó trên instance đang giữ lock, và mỗi tick vẫn ghi [[last_run_at]] xuống bảng; lúc Watchtower recreate container, instance mới đọc bảng và chạy bù thay vì chờ tick kế tiếp.
- Câu chuyện phỏng vấn: "scheduled scan chập chờn, không ai biết vì lịch chỉ sống trong RAM; tôi persist lịch, thêm leader election bằng advisory lock và metric missed ticks; alert bắt được tick lỡ đầu tiên trong vòng 1 phút".
`,
  quiz: [
    { t: 'mc', q: 'Cluster Raft 5 node đang có 2 node chết. Điều gì đúng?', o: ['Cluster ngừng nhận write vì mất 40% node', 'Cluster vẫn commit được vì 3 node còn lại là majority', 'Cluster chỉ phục vụ read, không write', 'Cần thêm node thứ 6 mới hoạt động lại'], a: 1, why: '5 = 2f+1 với f = 2; còn 3 node là majority nên vẫn bầu leader và commit được.' },
    { t: 'mc', q: 'Vì sao Raft dùng election timeout ngẫu nhiên (150–300 ms) thay vì cố định?', o: ['Để giảm tải mạng khi heartbeat', 'Để follower có log dài hơn luôn thắng', 'Để tránh nhiều candidate cùng lúc gây split vote lặp lại', 'Để leader có thời gian flush log xuống đĩa'], a: 2, why: 'Timeout khác nhau làm một node timeout trước, xin phiếu và thường thắng trước khi node khác kịp ứng cử.' },
    { t: 'mc', q: 'Kleppmann phản đối Redlock chủ yếu vì lý do nào?', o: ['Redis quá chậm cho lock', 'Redlock cần tối thiểu 7 node', 'Lua script không atomic trên cluster', 'Không có fencing token nên process pause dài hơn TTL vẫn ghi được; và giả định đồng hồ không nhảy'], a: 3, why: 'Hai luận điểm chính: thiếu fencing token để storage từ chối holder cũ, và phụ thuộc vào đồng hồ hệ thống đồng bộ.' },
    { t: 'mc', q: 'Bạn dùng pg_advisory_lock session-level để chọn leader scheduler nhưng app kết nối qua PgBouncer transaction pooling. Hậu quả khả dĩ nhất?', o: ['Lock hoạt động bình thường vì Postgres quản lý lock', 'Lock gắn với connection vật lý bị trả về pool nên hai instance đều tưởng mình là leader hoặc lock dính sang session khác', 'PgBouncer từ chối câu lệnh advisory lock', 'Lock tự chuyển sang transaction-level'], a: 1, why: 'Trong transaction pooling, mỗi câu lệnh có thể chạy trên connection khác; lock session-level mất ý nghĩa.' },
    { t: 'mc', q: 'Thứ nào KHÔNG nên lưu trong etcd?', o: ['Danh sách 2 triệu component đã parse từ SBOM', 'Địa chỉ các instance của service (discovery)', 'Key leader election của scheduler', 'Feature flag cho từng tenant'], a: 0, why: 'etcd quota 2–8 GB, mọi write qua Raft + fsync; dữ liệu nghiệp vụ lớn phải ở Postgres hoặc object storage.' },
    { t: 'fill', q: 'Điền: số tăng đơn điệu được cấp cùng lock để storage từ chối ghi của holder cũ gọi là ___ token.', a: ['fencing', 'fencing token'], why: 'Fencing token là cách duy nhất chống process pause dài hơn TTL mà vẫn ghi vào storage.' },
    { t: 'fill', q: 'Điền: để chịu được f node lỗi, cluster consensus cần tối thiểu ___ node (viết dạng biểu thức theo f).', a: ['2f+1', '2f + 1', '2*f+1', '2 f + 1'], why: 'Hai majority bất kỳ của 2f+1 node luôn giao nhau ít nhất một node, nên không có hai leader cùng term.' },
    { t: 'open', q: 'Scheduled job của bạn chạy bằng gocron trong RAM trên 2 instance, đôi khi chạy đôi, đôi khi lỡ tick khi redeploy. Thiết kế lại thế nào mà không thêm hệ thống mới?', a: 'Persist lịch vào Postgres: bảng jobs với next_run_at, last_run_at, lock_until; lúc start đọc bảng và chạy bù (catch-up) nếu lỡ. Mutual exclusion bằng advisory lock trên connection riêng để chọn leader, hoặc claim từng job bằng SELECT FOR UPDATE SKIP LOCKED để mọi instance cùng kéo job khác nhau. Job phải idempotent theo khóa job_id + scheduled_at vì lock không bảo đảm exactly-once. Thêm metric missed ticks và alert. Không dựng etcd vì Postgres đã là failure domain duy nhất của app.', keys: ['persist', 'advisory lock', 'skip locked', 'idempotent', 'catch-up'] }
  ]
},
{ id: 'B7', type: 'block', topic: 'queue', title: 'Giao dịch phân tán: 2PC, saga, outbox, CDC, idempotency, exactly-once', time: '130 phút',
  goal: 'Nhận ra dual write trong code của mình; chọn đúng giữa 2PC, saga và outbox cho từng luồng; thiết kế được outbox + idempotent consumer hoàn chỉnh (bảng, relay, inbox) và nói rõ exactly-once của Kafka bao phủ tới đâu.',
  md: `
### Vấn đề cần giải
Một thao tác nghiệp vụ hiếm khi chỉ chạm một nơi: lưu SBOM vào Postgres, publish message cho worker, ghi file lên S3, gọi API ngoài, ghi audit log. Không có transaction nào bao trùm tất cả. Crash hoặc lỗi mạng ở giữa thì hệ thống **lệch nhau**: DB có mà message không, message có mà DB chưa. Đây là **dual write problem**, gốc của phần lớn "mất dữ liệu bí ẩn". Sự cố #12 của bạn là một biến thể tinh vi: publish audit event **trong** transaction, trước commit; consumer nhanh hơn commit, đọc DB thấy chưa có hàng cha, FK violation, bỏ message, mất log. Sự cố #14 là biến thể khác: thao tác "thay thế toàn bộ" không atomic, một lần chạy lỗi xóa sạch kết quả của lần chạy tốt. Bài này xếp các công cụ theo mức bảo đảm: **2PC** (atomic thật nhưng blocking), **saga** (eventual + bù trừ), **outbox/CDC** (atomic cục bộ + at-least-once), **idempotency** (biến at-least-once thành đúng một hiệu ứng).

### Cốt lõi
#### Dual write: nhận diện trước khi chữa
- Ghi DB rồi publish: crash giữa hai bước thì DB có, message không; retry publish bằng tay là việc không ai làm lúc 3 giờ sáng.
- Publish rồi ghi DB (hoặc publish trong tx trước commit, #12): message có, dữ liệu chưa; consumer đọc hụt. Rollback tx thì message vẫn đã đi, không rút lại được.
- Quy tắc: hai hệ thống độc lập không thể atomic với nhau trừ khi (a) cả hai tham gia một protocol commit chung (2PC/XA) hoặc (b) một bên **dẫn xuất** từ bên kia (outbox, CDC đọc WAL).

#### 2PC: atomic thật, trả giá bằng blocking
- Coordinator hỏi mọi participant **prepare** (ghi redo/undo log, fsync, giữ lock, trả yes/no); đủ yes thì gửi **commit**, không thì **abort**. Chi phí: 2 round trip + 2 fsync mỗi participant, lock giữ suốt hai pha.
- Lỗi chí mạng: coordinator chết sau khi participant đã vote yes thì participant ở trạng thái **in-doubt**, không dám commit cũng không dám abort, giữ lock vô hạn cho tới khi coordinator hồi phục. Vì vậy 2PC chỉ hợp lý khi coordinator có HA riêng.
- Dùng ở đâu: **bên trong** một hệ phân tán có kiểm soát (Spanner, CockroachDB dùng 2PC cho tx đa shard, coordinator state đặt trên Paxos/Raft). XA giữa DB và MQ ở tầng ứng dụng thì hiếm: driver hỗ trợ kém, Go gần như không có, throughput thấp. Giữa các microservice qua HTTP: không.

#### Saga: chuỗi local transaction + bù trừ
- Chia thành T1, T2, ... Tn, mỗi Ti commit riêng và có **compensating transaction** Ci. Lỗi ở Tk thì chạy C(k-1) ... C1 theo chiều ngược. Compensation là "hành động ngược về nghiệp vụ", không phải undo kỹ thuật: email đã gửi thì gửi email hủy; tiền đã trừ thì hoàn.
- **Choreography**: mỗi service nghe event và phát event kế tiếp. Không có điểm điều phối, bắt đầu nhanh; nhưng quá 3–4 bước thì không ai vẽ được luồng, dễ vòng lặp event, khó biết saga nào đang kẹt.
- **Orchestration**: một orchestrator giữ state machine (Temporal, AWS Step Functions, hoặc đơn giản một bảng [[saga_state]] trong Postgres), gọi từng bước, lưu bước hiện tại, retry và chạy compensation. Dễ debug, dễ timeout; orchestrator là điểm tập trung logic nên state phải persist để restart không mất dấu.
- **Cô lập kém** là điểm yếu cốt lõi: T1 đã commit và nhìn thấy được trước khi saga xong, nên người khác đọc được trạng thái "nửa chừng". Cách đỡ: **semantic lock** (cột [[status = PENDING]] để người đọc biết chưa chốt), **commutative update** (cộng trừ thay vì gán), **pessimistic ordering** (đặt bước dễ hỏng lên trước để ít phải bù), **reread** trước khi ghi.

:::diagram
Orch[Saga orchestrator] -> T1[T1 lưu SBOM revision]
Orch -> T2[T2 enrich license, vuln]
Orch -> T3[T3 đánh giá policy]
Orch -> T4[T4 gửi notification]
T3 -> Orch : lỗi hoặc timeout
Orch -> C2[C2 đánh dấu enrichment void]
Orch -> C1[C1 soft-delete revision]
Orch -> State[Bảng saga_state] : persist bước hiện tại
:::

| Tiêu chí | 2PC / XA | Saga choreography | Saga orchestration |
|---|---|---|---|
| Atomic | có, lock giữ 2 pha | không, eventual | không, eventual |
| Cô lập | có | kém, cần semantic lock | kém, cần semantic lock |
| Khi coordinator chết | participant in-doubt, kẹt lock | không có coordinator | state persist, resume được |
| Độ phức tạp vận hành | driver XA, hiếm | event lan tỏa, khó trace | thêm một state machine |
| Hợp với | tx đa shard trong một DB cluster | 2–3 bước, team độc lập | luồng dài, cần retry/timeout rõ |

#### Outbox pattern: atomic cục bộ, rồi at-least-once
Ý tưởng: không publish trực tiếp. Ghi event vào bảng [[outbox]] **trong cùng transaction** với dữ liệu nghiệp vụ; một relay đọc outbox và publish. Event chỉ rời DB sau khi commit, nên #12 không thể xảy ra, và crash ở bất kỳ đâu cũng chỉ gây trùng, không gây mất.
- Bảng: [[outbox(id bigserial, aggregate_type, aggregate_id, event_type, payload jsonb, created_at, published_at null)]]. Partial index [[WHERE published_at IS NULL]] để poller không quét cả bảng (bài học #16 áp vào đây).
- **Relay kiểu poller**: mỗi 100–500 ms chạy [[SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED]], publish từng message với publisher confirm, rồi [[UPDATE published_at = now()]]. Nhiều relay instance chạy song song nhờ SKIP LOCKED. Crash sau publish trước update thì message đi hai lần: **at-least-once**, chấp nhận.
- **Relay kiểu CDC**: Debezium đọc WAL qua logical replication slot, đẩy vào Kafka; độ trễ vài chục ms, không poll. Trả giá: thêm Kafka Connect; replication slot **giữ WAL** khi connector chết, đĩa Postgres đầy sau vài giờ nếu không giám sát [[pg_replication_slots]].
- Thứ tự: giữ thứ tự theo [[id]] trong một aggregate khi publish tuần tự hoặc dùng [[aggregate_id]] làm partition key/routing key.
- Dọn dẹp: xóa dòng đã publish quá 7 ngày, hoặc partition theo ngày và drop partition.
- Tại sao "after-commit hook" chưa đủ: hook chạy sau commit nhưng crash giữa commit và publish vẫn mất event; đó là dual write trì hoãn, không phải outbox.

:::diagram
API[API server] -> DB[Postgres cùng tx] : INSERT dữ liệu + INSERT outbox
Relay[Outbox relay] -> DB : SELECT SKIP LOCKED
Relay -> MQ[RabbitMQ hoặc Kafka] : publish + confirm
Relay -> DB : UPDATE published_at
MQ -> Consumer[Consumer] : at-least-once
Consumer -> Inbox[Bảng inbox dedup] : INSERT message_id ON CONFLICT DO NOTHING
Inbox -> Consumer : trùng thì bỏ qua
:::

#### Idempotency: phía nhận phải chịu được trùng
- **Inbox / dedup table**: [[inbox(message_id primary key, processed_at)]]; consumer mở tx, [[INSERT ... ON CONFLICT DO NOTHING]], nếu 0 hàng thì ack và bỏ qua, nếu 1 hàng thì xử lý **trong cùng tx** rồi commit. Dedup và side effect phải cùng tx, nếu không lại là dual write.
- **Idempotency key cho API** (mô hình Stripe): client gửi header [[Idempotency-Key]] (UUID), server lưu (key, hash request, status, response) với TTL 24 giờ. Cùng key cùng hash thì trả response cũ; cùng key khác hash thì 422; key đang xử lý thì 409. Dùng cho mọi POST tạo tài nguyên hoặc gây side effect.
- Thao tác tự idempotent: [[SET x = 5]], UPSERT theo natural key, "tạo nếu chưa có". Không idempotent: [[x = x + 1]], append log, gửi email. Thiết kế payload event theo kiểu trạng thái đích thay vì delta khi có thể.

#### Exactly-once của Kafka thực chất là gì
- **Idempotent producer**: broker gắn producer id + sequence number theo partition, loại bỏ bản ghi trùng do retry. Chỉ chống trùng trong **một partition, một producer session**; không liên quan gì tới consumer hay hệ ngoài.
- **Transactions**: producer ghi vào nhiều partition **và commit offset của consumer group** trong một tx atomic (transaction coordinator ghi vào [[__transaction_state]]); consumer đặt [[isolation.level=read_committed]] để không thấy tx chưa commit. Kết quả: exactly-once cho pipeline **Kafka vào Kafka** (Kafka Streams EOS), với chi phí commit theo chu kỳ [[commit.interval.ms]] 100 ms và throughput giảm.
- **Không bao phủ** side effect ngoài Kafka: ghi Postgres, gọi API, gửi email. Với sink ngoài, cách đúng là **lưu offset cùng dữ liệu** trong cùng tx của sink (store offset with data) hoặc sink idempotent theo key.
- Câu chốt: exactly-once **delivery** không tồn tại trên mạng không tin cậy; exactly-once **effect** đạt được bằng at-least-once + idempotent/transactional sink.

#### Thao tác thay thế toàn bộ không atomic: bài học từ sự cố #14
Reconcile policy chạy theo kiểu "đánh giá lại rồi diff với toàn bộ violation của policy": một lần eval lỗi hoặc trả 0 kết quả bị hiểu là "không còn vi phạm" và soft-delete toàn bộ violation của lần tốt trước đó; hậu quả 910k violation mồ côi. Bốn quy tắc rút ra:
1. Lỗi hoặc 0 kết quả là tín hiệu **không biết**, không phải **không có**: không được dùng để xóa. Eval lỗi phải "compensate" bằng không làm gì.
2. Diff phải **cùng scope** với dữ liệu vừa sinh ra (đúng target, đúng policy, đúng revision); diff cross-scope là xóa dữ liệu người khác.
3. Replace-all phải atomic: trong một tx, hoặc theo **generation swap** (ghi [[generation = n+1]], đổi con trỏ current, xóa generation cũ sau).
4. Guard rail dữ liệu: nếu một lần reconcile định xóa hơn X% (ví dụ 20%) số hàng hiện có thì dừng và alert thay vì tiếp tục; đây là circuit breaker cho dữ liệu.

### Số liệu cần nhớ
| Con số | Giá trị | Ghi chú |
|---|---|---|
| 2PC | 2 round trip + 2 fsync mỗi participant, lock giữ suốt | in-doubt khi coordinator chết |
| Outbox poller | chu kỳ 100–500 ms, batch 100–1 000 | partial index bắt buộc |
| Debezium CDC | độ trễ end-to-end vài chục ms | giám sát WAL do slot giữ |
| Kafka EOS | commit.interval.ms mặc định 100 ms khi bật EOS; max.in.flight tối đa 5 với idempotent producer | chỉ Kafka vào Kafka |
| Idempotency key | TTL 24 giờ (Stripe), lưu cả hash request | cùng key khác payload là lỗi 422 |

### Sai lầm hay gặp
- Publish trong transaction trước commit (#12), hoặc publish ngay sau commit mà không có outbox; cả hai đều là dual write.
- Tin rằng "after commit hook" hay "transactional event listener" là outbox. Không: crash giữa commit và publish vẫn mất event.
- Consumer không idempotent vì "broker exactly-once rồi"; không có broker nào bảo đảm hiệu ứng ngoài chính nó.
- Dedup bằng cache Redis tách khỏi tx xử lý: Redis ghi xong, DB rollback, message bị coi là đã xử lý.
- Saga không persist state, orchestrator restart là mất dấu; compensation gọi API không retry, không idempotent nên saga kẹt nửa chừng mãi mãi.
- Outbox không partial index, không dọn dẹp: poller quét bảng 50 triệu dòng mỗi 200 ms.
- CDC slot không giám sát: connector chết, WAL phình, Postgres hết đĩa trước khi ai nhận ra.
- Reconcile "xóa hết rồi ghi lại" không atomic, coi 0 kết quả là "không có" (#14).
- Idempotency key không kèm hash request: cùng key, payload khác, trả về response của request cũ.

### Nói thế nào trong phỏng vấn (EN)
- "Writing to the database and then publishing to the broker is a dual write; either step can fail alone, so I use the outbox pattern to make the event part of the same transaction." — Ghi DB rồi publish là dual write; dùng outbox để event nằm trong cùng transaction.
- "Two-phase commit gives atomicity but blocks when the coordinator dies; I only accept it inside a database cluster that owns the coordinator, not across microservices." — 2PC atomic nhưng blocking khi coordinator chết; chỉ chấp nhận bên trong một DB cluster.
- "A saga trades isolation for availability: each step commits locally and failures are compensated, so I add a pending status so readers know the flow is not final." — Saga đổi cô lập lấy availability; thêm trạng thái pending để người đọc biết chưa chốt.
- "Kafka exactly-once covers Kafka-to-Kafka pipelines through idempotent producers and transactions; for external sinks I still need idempotent writes or storing the offset with the data." — EOS của Kafka chỉ cho Kafka vào Kafka; sink ngoài vẫn cần idempotent hoặc lưu offset cùng dữ liệu.
- "At-least-once delivery plus an idempotent consumer is how you actually get exactly-once effects." — At-least-once cộng consumer idempotent mới là cách đạt exactly-once về hiệu ứng.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #12 (audit log) chữa tận gốc bằng outbox: [[t_audit_outbox]] ghi trong cùng tx với bảng nghiệp vụ ở apiserver; một goroutine relay dùng [[FOR UPDATE SKIP LOCKED]] publish lên RabbitMQ với publisher confirm rồi đánh dấu [[published_at]]. Consumer Bento thêm bảng inbox theo [[message_id]]. Việc tuần này: grep mọi chỗ gọi publish bên trong hàm có [[tx]] đang mở; liệt kê thành danh sách dual write.
- Sự cố #14 (reconcile wipe): sửa reconcile theo bốn quy tắc: eval lỗi hoặc 0 association thì **không diff**; diff đúng scope target × policy × revision; replace bằng generation swap trong một tx; guard rail dừng nếu định soft-delete quá 20% violation của tenant và bắn alert. Viết lại 910k violation mồ côi là việc migration riêng, đừng trộn vào code path.
- Enrichment write-back từ Lambda vào PRCL/t_components là sink ngoài Kafka/RabbitMQ: phải idempotent theo [[(tenant, component_id, revision)]] bằng UPSERT có điều kiện version, vì Lambda retry và sweeper có thể gửi cùng coordinate hai lần (liên hệ sự cố #7, #8).
- Luồng upload SBOM thực chất là saga 4 bước: lưu revision, enrich, policy eval, notification. Hiện nay bước lỗi để lại revision "nửa chừng" không ai biết (sự cố #2 pending kẹt hàng giờ): thêm cột [[status]] làm semantic lock, bảng [[saga_state]] để worker restart tiếp tục được, và compensation rõ ràng (đánh dấu enrichment void thay vì để pending vô hạn).
- Idempotency key cho [[POST /sboms]]: khóa theo [[tenant_id + sha256(file)]], TTL 24 giờ; client retry khi mạng lỗi không tạo hai revision. Trả 409 khi cùng key đang xử lý.
- Outbox partial index và dọn dẹp: áp bài học #16, tạo [[idx_outbox_unpublished ON outbox(id) WHERE published_at IS NULL]] ngay từ migration đầu, job xóa dòng quá 7 ngày.
- Reconcile và sweeper đều là "consumer của chính mình": gắn [[run_id]] cho mỗi lần chạy, log số hàng thêm/xóa mềm theo run; một biểu đồ "rows soft-deleted per run" đã đủ bắt sự cố #14 ngay lần chạy đầu thay vì sau 910k hàng.
- ADR gợi ý: "Mọi event rời apiserver/worker đi qua outbox; consumer bắt buộc có inbox dedup; không có exactly-once ở broker". Đo: số event trùng consumer bỏ qua mỗi ngày (phải lớn hơn 0 và nhỏ), độ trễ outbox p99 (mục tiêu dưới 1 s).
`,
  quiz: [
    { t: 'mc', q: 'Vì sao 2PC được gọi là blocking protocol?', o: ['Participant đã vote yes phải giữ lock chờ quyết định; coordinator chết thì chờ vô hạn (in-doubt)', 'Mỗi pha cần quét toàn bộ bảng', 'Participant phải chờ mọi client khác hoàn tất', 'Coordinator chỉ xử lý một transaction mỗi lần'], a: 0, why: 'Sau prepare, participant không thể tự quyết commit hay abort; mất coordinator là kẹt lock cho tới khi nó hồi phục.' },
    { t: 'mc', q: 'Outbox pattern bảo đảm điều gì?', o: ['Exactly-once delivery tới consumer', 'Event được publish đồng thời với commit', 'Thứ tự toàn cục của mọi event trong hệ thống', 'Event chỉ rời DB sau khi tx commit, giao at-least-once; consumer phải idempotent'], a: 3, why: 'Outbox loại bỏ mất event nhưng relay crash giữa publish và update vẫn gây trùng, nên cần dedup phía nhận.' },
    { t: 'mc', q: 'Kafka exactly-once semantics (idempotent producer + transactions) bao phủ tới đâu?', o: ['Mọi side effect của consumer, kể cả ghi DB', 'Chỉ chống trùng khi broker restart', 'Pipeline Kafka vào Kafka: ghi nhiều partition và commit offset consumer group atomic', 'Chỉ giữa producer và một partition, không liên quan consumer'], a: 2, why: 'Transactions gom việc ghi output và commit offset vào một tx; sink ngoài Kafka vẫn cần idempotent hoặc lưu offset cùng dữ liệu.' },
    { t: 'mc', q: 'Saga có điểm yếu cố hữu nào so với transaction ACID, và cách đỡ phổ biến?', o: ['Không có atomicity; đỡ bằng 2PC cho từng bước', 'Không có isolation vì từng bước commit riêng; đỡ bằng semantic lock như cột status PENDING', 'Không có durability; đỡ bằng replica', 'Không có consistency; đỡ bằng foreign key'], a: 1, why: 'Người đọc thấy trạng thái nửa chừng của saga; cột trạng thái cho họ biết luồng chưa chốt.' },
    { t: 'mc', q: 'Audit event được publish bên trong transaction trước commit, consumer đọc DB bị FK violation. Cách sửa bền nhất?', o: ['Thêm sleep 500 ms ở consumer trước khi đọc DB', 'Publish sau commit bằng after-commit hook', 'Retry consumer 3 lần khi FK violation', 'Ghi event vào bảng outbox trong cùng tx, relay publish sau commit, consumer dedup bằng inbox'], a: 3, why: 'Sleep và retry chỉ che triệu chứng; after-commit hook vẫn mất event nếu crash giữa commit và publish; outbox là cách duy nhất không mất.' },
    { t: 'fill', q: 'Điền: bảng ghi event trong cùng transaction với dữ liệu nghiệp vụ, rồi relay đọc ra để publish, gọi là bảng ___.', a: ['outbox', 'transactional outbox'], why: 'Outbox biến dual write thành một write cục bộ cộng một bước publish at-least-once.' },
    { t: 'fill', q: 'Điền: trong saga, hành động nghiệp vụ ngược để hoàn tác một bước đã commit gọi là ___ transaction.', a: ['compensating', 'compensation', 'compensating transaction'], why: 'Không phải undo kỹ thuật mà là hành động ngược về nghiệp vụ, phải idempotent và retry được.' },
    { t: 'open', q: 'Thiết kế pipeline audit log đáng tin cậy: API ghi dữ liệu và phải phát sinh audit event tới consumer ghi vào kho audit. Không được mất event, được phép trùng. Trình bày các thành phần và bảo đảm của từng bước.', a: 'API ghi dữ liệu và insert vào bảng outbox trong cùng transaction nên không có dual write. Relay poller dùng SELECT FOR UPDATE SKIP LOCKED lấy dòng chưa publish, publish lên broker với publisher confirm, rồi đánh dấu published_at; crash giữa chừng chỉ gây trùng. Consumer mở tx, insert message_id vào bảng inbox với ON CONFLICT DO NOTHING, nếu trùng thì ack bỏ qua, nếu mới thì ghi audit trong cùng tx rồi commit, đạt exactly-once về hiệu ứng. Partial index trên published_at IS NULL, dọn outbox định kỳ, metric độ trễ outbox và số message trùng để alert.', keys: ['outbox', 'cùng transaction', 'at-least-once', 'idempotent', 'inbox'] }
  ]
},
{ id: 'B8', type: 'block', topic: 'queue', title: 'Message broker và streaming chuyên sâu: Kafka, RabbitMQ, SQS/SNS; event-driven; event sourcing; CQRS', time: '150 phút',
  goal: 'Chọn đúng broker cho từng luồng (log phân tán vs queue vs managed pub/sub) và bảo vệ được lựa chọn bằng số liệu; thiết kế publisher/consumer sống sót khi broker restart; phân biệt event notification, event-carried state, event sourcing, CQRS và biết khi nào không dùng.',
  md: `
### Vấn đề cần giải
Hàng đợi tách producer khỏi consumer về **thời gian** (consumer chết 10 phút vẫn không mất việc), **tốc độ** (upload đỉnh 50 file/phút, enrichment chỉ xử lý 10) và **failure domain**. Nhưng "dùng message queue" thực ra là chọn giữa ba mô hình khác hẳn nhau: **queue truyền thống** (RabbitMQ, SQS: broker đẩy, message bị xóa sau ack, routing phong phú), **log phân tán** (Kafka: append-only, consumer tự giữ offset, replay được) và **managed pub/sub** (SNS fan-out). Chọn sai thì hoặc nghẹt (RabbitMQ với backlog 1 TB), hoặc gánh một cluster Kafka cho 50 message/giây. Và broker không tự làm hệ thống đáng tin: sự cố #1 của bạn, publisher singleton không reconnect sau khi RabbitMQ bị recreate, làm mọi cron job im lặng nhiều ngày mà không có một alert nào.

### Cốt lõi
#### Kafka: log phân tán, consumer tự nhớ mình đọc tới đâu
- **Topic** chia thành **partition**; mỗi partition là một log append-only với **offset** tăng đơn điệu. Message có key thì [[hash(key) mod partitions]] quyết định partition, nên **ordering chỉ có trong một partition** (theo key), không có ordering toàn topic.
- **Consumer group**: mỗi partition được đúng một consumer trong group đọc; consumer nhiều hơn partition thì thừa ngồi không. Offset do consumer commit vào [[__consumer_offsets]]; replay chỉ cần seek về offset cũ. Hai group độc lập đọc cùng topic không ảnh hưởng nhau (pub/sub).
- **Rebalancing**: consumer vào/ra group thì chia lại partition. Eager rebalance dừng cả group vài giây; cooperative incremental (từ 2.4) chỉ di chuyển phần cần. Bẫy thường gặp: xử lý một batch lâu hơn [[max.poll.interval.ms]] (mặc định 5 phút) thì consumer bị coi là chết, bị đá ra, rebalance, và batch đó được xử lý lại ở nơi khác: trùng hàng loạt.
- **Retention**: theo thời gian hoặc dung lượng (mặc định 7 ngày), hoặc **compaction** giữ bản mới nhất của mỗi key (dùng cho changelog, state, config).
- **Replication**: mỗi partition có leader và follower; **ISR** (in-sync replicas) là tập follower theo kịp. Producer [[acks=all]] + [[min.insync.replicas=2]] với replication factor 3: chịu được 1 broker chết mà không mất dữ liệu đã ack. [[acks=1]] nhanh hơn nhưng mất dữ liệu khi leader chết trước khi follower sao chép.
- Hiệu năng: sequential I/O, batching, zero-copy; một broker đạt hàng trăm MB/s, độ trễ vài ms. Số partition là đơn vị song song nhưng không giảm được, nhiều partition làm rebalance lâu và tốn file handle. Rule: partition = throughput mục tiêu chia cho ~10 MB/s mỗi partition (quy ước bảo thủ; Confluent chỉ nói "hàng chục MB/s" tùy batch, nén, acks — nên đo p, c thật rồi lấy max(t/p, t/c)), rồi làm tròn lên và chừa chỗ.

:::diagram
Prod[Producer key=tenant_id] -> P0[Partition 0]
Prod -> P1[Partition 1]
Prod -> P2[Partition 2]
P0 -> CA[Consumer A group enrich]
P1 -> CA
P2 -> CB[Consumer B group enrich]
P0 -> CX[Consumer X group audit]
P1 -> CX
P2 -> CX
:::

#### RabbitMQ: smart broker, dumb consumer
- **Exchange** nhận message và route theo **binding** tới queue: **direct** (routing key bằng đúng), **topic** (pattern [[sbom.*.uploaded]], [[sbom.#]]), **fanout** (mọi queue gắn vào), **headers** (theo header). Queue là FIFO, message bị xóa sau ack.
- **Ack / prefetch**: consumer ack, nack hoặc reject; [[prefetch]] (QoS) giới hạn số message chưa ack mỗi consumer để một consumer chậm không nuốt hết queue. Job dài (enrich một SBOM 5 phút) đặt prefetch 1–5; job nhỏ đặt 50–300.
- **Publisher confirm**: broker báo đã ghi message (queue durable + message persistent) cho publisher. Không bật confirm là fire-and-forget: broker chết, message biến mất không lỗi. Thêm cờ [[mandatory]] để nhận lại message không route được thay vì im lặng mất.
- **DLX** (dead-letter exchange) nhận message bị reject, hết TTL hoặc queue đầy. Kết hợp TTL để làm **retry có backoff**: queue [[retry.30s]] không consumer, TTL 30 s, dead-letter về exchange gốc; đếm [[x-death]] để quá 5 lần thì vào parking lot cho người xem.
- **Lazy queue** ghi đĩa sớm, không giữ message trong RAM (mặc định với classic queue v2 từ 3.12): backlog lớn không làm broker OOM. **Quorum queue** replicate bằng Raft trên 3 node, thay mirrored queue; có [[delivery-limit]] để tự dead-letter poison message. Dùng cho dữ liệu không được mất.
- Giới hạn: RabbitMQ tối ưu cho queue gần rỗng; backlog hàng triệu message làm throughput tụt. Một node đạt vài chục nghìn message/giây; không replay sau ack.
- **Connection và channel**: connection TCP đắt (một hoặc vài cái mỗi process), channel nhẹ (một cho mỗi goroutine publish). Connection chết thì **mọi channel chết theo**; client phải tự reconnect và khai báo lại topology. Thư viện Go [[amqp091]] không tự làm việc này.

:::diagram
P[Publisher confirm] -> X[Exchange topic] : key sbom.uploaded
X -> Q1[Queue enrich] : binding sbom.uploaded
X -> Q2[Queue audit] : binding sbom.#
Q1 -> C1[Worker prefetch 5] : ack hoặc nack
C1 -> DLX[Dead-letter exchange] : nack requeue=false
DLX -> R[Queue retry TTL 30 s]
R -> X : hết TTL, quay lại exchange
DLX -> Park[Parking lot sau 5 lần]
:::

#### SQS / SNS: trả tiền để khỏi vận hành
- **SQS standard**: at-least-once, ordering best-effort, throughput gần như không giới hạn. **SQS FIFO**: ordering theo [[MessageGroupId]], dedup 5 phút theo [[MessageDeduplicationId]]; 300 message/giây mỗi group (3 000 với batch), high-throughput mode cao hơn.
- **Visibility timeout**: nhận message thì nó ẩn đi; không delete trước khi hết timeout thì hiện lại cho consumer khác. Phải dài hơn thời gian xử lý, gia hạn bằng [[ChangeMessageVisibility]] với job dài. Long polling 20 s để bớt request rỗng. Retention tối đa 14 ngày. **DLQ** theo [[maxReceiveCount]], có redrive ngược lại.
- **SNS**: fan-out một message tới nhiều đích (SQS, Lambda, HTTP) với filter policy. Mẫu chuẩn: SNS topic → mỗi consumer một SQS queue riêng để mỗi bên có buffer và DLQ riêng.

| Tiêu chí | Kafka | RabbitMQ | SQS standard / FIFO | SNS + SQS |
|---|---|---|---|---|
| Mô hình | log, consumer giữ offset | queue, broker đẩy, xóa sau ack | queue managed | pub/sub fan-out managed |
| Ordering | theo partition (key) | theo queue, một consumer | best-effort / theo group | theo SQS đích |
| Replay | có, seek offset | không | không | không |
| Routing | theo topic, key | rất giàu (topic, headers, DLX) | không | filter policy |
| Backlog lớn | thoải mái, đĩa rẻ | yếu, cần lazy queue | thoải mái, 14 ngày | như SQS |
| Throughput | hàng trăm MB/s mỗi broker | vài chục nghìn msg/s mỗi node | gần vô hạn / 300–3 000 msg/s mỗi group | như SQS |
| Vận hành | nặng: broker, KRaft, partition | vừa | không | không |
| Hợp với | event stream, analytics, replay, nhiều consumer | task queue, retry/backoff, routing phức tạp | task queue trên AWS, ít vận hành | fan-out một sự kiện cho nhiều team |

#### Event-driven: hai kiểu event, một quy tắc đặt tên
- **Event notification**: event chỉ nói "component 42 đã đổi"; consumer gọi lại API lấy chi tiết. Nhẹ, dữ liệu luôn mới, nhưng coupling lúc chạy (API chết là consumer chết theo) và N+1 call khi burst.
- **Event-carried state transfer**: event mang đủ trạng thái; consumer tự xử lý, không gọi về. Tự chủ và nhanh, nhưng payload lớn, consumer giữ bản sao có thể cũ; cần [[version]] hoặc timestamp để bỏ qua event đến muộn (out-of-order).
- **Command vs event**: command là yêu cầu gửi tới một người nhận ([[EnrichComponent]]), event là sự thật đã xảy ra ([[sbom.uploaded]], quá khứ). Trộn hai thứ là nguồn gốc của event có tên kiểu "please_do_x".

#### Event sourcing và snapshot
- Lưu chuỗi event bất biến làm nguồn chân lý; trạng thái hiện tại là fold của các event. Được: audit đầy đủ, replay để sửa bug trong quá khứ, time travel, debug "vì sao ra trạng thái này".
- Trả giá: đọc trạng thái phải replay, nên cần **snapshot** mỗi N event (ví dụ 100) rồi chỉ replay phần sau; schema event sống mãi (cần upcaster để đọc event cũ); xóa dữ liệu cá nhân khó (crypto-shredding: mã hóa theo khóa người dùng, xóa khóa là xóa dữ liệu).
- Khi **không** dùng: CRUD bình thường, cần query ad-hoc nhiều, team chưa từng vận hành event store. Hầu hết hệ thống chỉ cần audit log tốt chứ không cần event sourcing.

#### CQRS: tách đọc và ghi, chấp nhận eventual
- Write model chuẩn hóa, validate nghiêm; read model denormalize theo đúng màn hình (bảng tổng hợp, Elasticsearch, materialized view). Read model cập nhật từ event nên **eventual consistent**: user vừa ghi, đọc lại chưa thấy.
- Cách đỡ read-your-writes: trả [[version]] trong response ghi, client chờ read model đạt version đó; hoặc route request của chính user vừa ghi về write model trong vài giây.
- CQRS không bắt buộc đi với event sourcing. Một bảng tổng hợp cập nhật bằng trigger hoặc job cũng là CQRS tối giản.

#### Schema evolution: hợp đồng sống qua nhiều phiên bản
- Dùng Avro hoặc Protobuf với schema registry. **Backward compatible**: consumer mới đọc được dữ liệu cũ (thêm field có default, không xóa field đang dùng). **Forward compatible**: consumer cũ đọc được dữ liệu mới (bỏ qua field lạ, không đổi kiểu). Full là cả hai; registry từ chối schema phá vỡ ngay lúc publish.
- Protobuf: không tái dùng field number, không đổi type, đánh dấu [[reserved]] khi bỏ field. JSON không schema: thêm field an toàn, đổi tên hoặc đổi kiểu là phá vỡ im lặng. Luôn có [[event_version]] trong header và consumer theo kiểu tolerant reader.

#### Publisher sống sót khi broker restart: giải sự cố #1
Chuyện đã xảy ra: [[*amqp.Connection]] tạo một lần lúc start, không ai lắng nghe [[NotifyClose]]. Watchtower recreate RabbitMQ, connection đóng, mọi [[Publish]] trả lỗi hoặc tệ hơn là không confirm và lỗi bị nuốt; cron job vẫn "chạy xong" nhưng không message nào tới worker. Không metric, không alert, phát hiện sau nhiều ngày khi khách hỏi vì sao Last Scanned đứng yên.
1. **Connection manager**: goroutine riêng giữ connection, lắng nghe [[NotifyClose]], reconnect với exponential backoff 1 s → 30 s có jitter; publisher luôn lấy channel qua manager, không giữ con trỏ cũ.
2. **Khai báo lại topology** sau mỗi lần reconnect (exchange, queue, binding, DLX) vì topology non-durable mất theo broker.
3. **Publisher confirm có timeout** 5 s; không confirm hoặc lỗi thì ghi vào outbox/retry và trả lỗi lên trên, không bao giờ nuốt.
4. **Metric và alert**: gauge [[amqp_connected]], counter [[amqp_publish_total{status}]]; alert khi connected = 0 quá 1 phút hoặc publish thành công = 0 trong cửa sổ mà cron đã chạy. Health endpoint của app phải phản ánh trạng thái broker.
5. **Consumer** cùng kiểu: gọi lại [[Consume]] sau reconnect; prefetch và ack thủ công; không ack trước khi xử lý xong.

### Số liệu cần nhớ
| Con số | Giá trị | Ghi chú |
|---|---|---|
| Kafka max.poll.interval.ms | 5 phút mặc định | vượt là bị đá khỏi group, rebalance, trùng |
| Kafka retention | 7 ngày mặc định; acks=all + min.insync.replicas=2 với RF 3 | chịu 1 broker chết không mất |
| RabbitMQ prefetch | 1–5 cho job dài, 50–300 cho job nhỏ | không prefetch là một consumer nuốt hết |
| SQS | visibility timeout mặc định 30 s, tối đa 12 giờ; retention tối đa 14 ngày; FIFO dedup 5 phút | timeout ngắn hơn xử lý là trùng |
| Reconnect backoff | 1 s → 30 s, có jitter | alert khi mất kết nối quá 1 phút |

### Sai lầm hay gặp
- Publisher singleton không reconnect, không confirm, không metric: broker restart là cả hệ thống im lặng (#1).
- Dùng Kafka cho task queue 50 message/giây cần retry theo từng message và routing: gánh cluster nặng mà không dùng replay.
- Dùng RabbitMQ làm buffer backlog hàng triệu message nhiều ngày: broker chậm dần, RAM phình nếu không lazy queue.
- Consumer Kafka xử lý batch lâu hơn max.poll.interval.ms rồi thắc mắc vì sao "rebalance liên tục" và xử lý trùng.
- Ack trước khi xử lý xong (auto-ack) để "nhanh": consumer crash là mất message.
- Visibility timeout SQS ngắn hơn thời gian xử lý: hai consumer cùng làm một việc.
- Event mang delta ("cộng 3") thay vì trạng thái đích, lại không có version: out-of-order là sai số vĩnh viễn.
- Đổi tên field JSON trong event rồi deploy producer trước consumer.
- Áp event sourcing cho hệ CRUD vì "sẽ cần audit", rồi tốn một quý làm snapshot và upcaster.

### Nói thế nào trong phỏng vấn (EN)
- "Kafka is a distributed log: consumers keep their own offsets, so I get replay and multiple independent consumer groups, but ordering only holds within a partition." — Kafka là log phân tán: consumer giữ offset, replay được, nhưng ordering chỉ trong partition.
- "RabbitMQ shines for task queues with rich routing and per-message retry through dead-letter exchanges; it struggles with very large backlogs." — RabbitMQ hợp task queue với routing giàu và retry qua DLX; yếu với backlog lớn.
- "I would never let a publisher be fire-and-forget: publisher confirms, reconnect with backoff, and a connected gauge with an alert are the minimum." — Không để publisher fire-and-forget: confirm, reconnect có backoff, gauge connected có alert là tối thiểu.
- "For SQS the visibility timeout must exceed processing time, and I extend it for long jobs; otherwise another consumer picks up the same message." — Visibility timeout phải dài hơn thời gian xử lý, gia hạn với job dài.
- "CQRS gives me a read model shaped for the screen, but it is eventually consistent, so I return a version and let the client wait for it." — CQRS cho read model đúng màn hình nhưng eventual; trả version để client chờ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #1 là việc đầu tiên: viết [[amqp.Manager]] trong package dùng chung cho apiserver và worker: một goroutine giữ connection, [[NotifyClose]] → reconnect backoff 1–30 s, khai báo lại exchange/queue/DLX, publish qua channel pool có confirm timeout 5 s. Thêm gauge [[amqp_connected]] và alert "connected = 0 quá 60 s" hoặc "publish_total không tăng trong 15 phút có cron". Đây cũng là câu chuyện phỏng vấn mạnh: hiện tượng, vì sao im lặng, cách bạn đóng lỗ hổng quan sát.
- Kiểm tra topology hiện tại: queue nào durable, message có persistent không, có DLX chưa. Nếu worker nack message lỗi với requeue=true thì poison message quay vòng mãi (liên hệ #7); chuyển sang DLX + queue retry TTL 30 s, 2 phút, 10 phút, rồi parking lot có dashboard.
- Prefetch: enrichment một SBOM lớn chạy nhiều phút, prefetch nên 1–2 cho queue enrich; queue notification nhỏ prefetch 100. Hiện nay nếu prefetch mặc định không giới hạn, một worker có thể giữ hàng trăm message trong khi worker khác rảnh.
- Có nên chuyển sang Kafka không: khối lượng hiện tại (vài chục message/giây, cần retry theo message, routing theo loại job) hợp RabbitMQ hơn. Kafka chỉ đáng khi cần replay lịch sử sự kiện cho nhiều consumer độc lập, ví dụ dòng sự kiện vulnerability feed cho analytics; viết ADR "chưa dùng Kafka" với tiêu chí quay lại xem xét.
- Event hiện tại mang gì: nếu [[sbom.uploaded]] chỉ có revision_id (notification) thì worker gọi lại DB là bình thường; nhưng event cập nhật license nên mang trạng thái đích kèm [[revision]] để consumer bỏ qua bản cũ, tránh kiểu first-writer-wins (#15).
- Enrichment đang chạy trên AWS Lambda được invoke trực tiếp: nếu một ngày chuyển sang hàng đợi, SQS + DLQ + visibility timeout 15 phút gia hạn theo tiến độ là lựa chọn ít vận hành nhất; FIFO theo [[MessageGroupId = tenant_id]] nếu cần thứ tự theo tenant.
- Schema event: thêm [[event_version]] vào header mọi message ngay bây giờ khi chỉ có một phiên bản; sau này đổi payload không phải "big bang" deploy producer và consumer cùng lúc.
- CQRS tối giản đã có sẵn: [[t_project_metrics]] là read model của dashboard (sự cố về distribution thiếu khi chain upload không tạo metrics). Ghi rõ ai cập nhật read model, khi nào, và cơ chế rebuild khi lệch, thay vì để một chain one-shot không retry.
`,
  quiz: [
    { t: 'mc', q: 'Kafka bảo đảm thứ tự message ở mức nào?', o: ['Toàn topic', 'Toàn cluster theo timestamp', 'Trong một partition; message cùng key vào cùng partition nên cùng key thì có thứ tự', 'Theo consumer group'], a: 2, why: 'Partition là log tuần tự; thứ tự giữa các partition không được bảo đảm.' },
    { t: 'mc', q: 'Mục đích chính của prefetch (QoS) trong RabbitMQ là gì?', o: ['Giới hạn số message chưa ack mỗi consumer để một consumer chậm không nuốt hết queue', 'Nén message trước khi gửi', 'Tăng số connection TCP tới broker', 'Bật persistent cho message'], a: 0, why: 'Không có prefetch, broker đẩy hết message vào consumer đầu tiên; các consumer khác rảnh trong khi một con quá tải.' },
    { t: 'mc', q: 'SQS: job xử lý mất 90 giây nhưng visibility timeout để mặc định 30 giây và không gia hạn. Hậu quả?', o: ['Message bị chuyển sang DLQ ngay', 'SQS từ chối nhận message mới', 'Consumer bị throttle', 'Message hiện lại sau 30 giây và consumer khác xử lý trùng'], a: 3, why: 'Visibility timeout phải dài hơn thời gian xử lý hoặc được gia hạn bằng ChangeMessageVisibility.' },
    { t: 'mc', q: 'RabbitMQ bị recreate; sau đó mọi cron job trong app "chạy xong" nhưng worker không nhận gì suốt nhiều ngày. Nguyên nhân khả dĩ nhất?', o: ['Queue bị đổi tên sau restart', 'Publisher giữ connection cũ không reconnect, publish lỗi hoặc không confirm bị nuốt, không có metric/alert', 'Consumer prefetch quá cao', 'Message bị TTL hết hạn'], a: 1, why: 'Connection chết kéo theo mọi channel; client amqp trong Go không tự reconnect, và thiếu confirm cộng thiếu alert làm lỗi vô hình.' },
    { t: 'mc', q: 'Thay đổi nào là an toàn backward và forward compatible trong Protobuf?', o: ['Đổi kiểu một field từ int32 sang string', 'Tái sử dụng field number của field đã xóa', 'Thêm field mới với field number mới, consumer cũ bỏ qua, consumer mới dùng default', 'Đổi tên message và deploy producer trước'], a: 2, why: 'Thêm field mới là thay đổi tương thích hai chiều; đổi kiểu và tái dùng số field phá vỡ im lặng.' },
    { t: 'fill', q: 'Điền: trong Kafka, tập replica đang theo kịp leader, dùng để quyết định acks=all đã đủ chưa, gọi là ___.', a: ['isr', 'in-sync replicas', 'in sync replicas', 'in-sync replica'], why: 'acks=all chờ mọi replica trong ISR; min.insync.replicas đặt ngưỡng tối thiểu để chấp nhận ghi.' },
    { t: 'fill', q: 'Điền: trong RabbitMQ, exchange nhận message bị reject, hết TTL hoặc tràn queue gọi là ___ (viết tắt 3 chữ).', a: ['dlx', 'dead letter exchange', 'dead-letter exchange'], why: 'DLX kết hợp TTL là cách chuẩn làm retry có backoff và parking lot cho poison message.' },
    { t: 'open', q: 'Hệ thống của bạn có luồng job nền (enrich, policy eval, notification) khoảng 30 message/giây, cần retry theo từng message và không được mất khi broker restart. Chọn broker nào, cấu hình những gì, và bảo vệ lựa chọn trước câu hỏi "sao không dùng Kafka"?', a: 'Chọn RabbitMQ (hoặc SQS nếu muốn managed): khối lượng nhỏ, cần routing theo loại job và retry theo từng message qua DLX với TTL tăng dần, không cần replay. Cấu hình: queue durable hoặc quorum queue, message persistent, publisher confirm có timeout, prefetch thấp cho job dài, ack thủ công sau khi xử lý xong, DLX và parking lot. Publisher có connection manager reconnect với backoff, khai báo lại topology, metric connected và publish_total có alert. Kafka chỉ đáng khi cần replay lịch sử cho nhiều consumer độc lập hoặc throughput hàng trăm MB/s; lúc đó mới trả giá vận hành partition và rebalance.', keys: ['rabbitmq', 'publisher confirm', 'dlx', 'reconnect', 'replay'] }
  ]
},
{ id: 'B9', type: 'block', topic: 'api', title: 'Rate limiting và traffic shaping: token bucket, leaky bucket, fixed/sliding window; phân tán với Redis', time: '110 phút',
  goal: 'So sánh được 5 thuật toán theo bộ nhớ, độ chính xác và burst; viết được token bucket phân tán atomic trên Redis; quyết định đặt limiter ở tầng nào, fail-open hay fail-closed; thiết kế được client-side limiter + concurrency limit + queue leveling cho việc gọi API ngoài.',
  md: `
### Vấn đề cần giải
Mọi tài nguyên đều hữu hạn: Postgres 4 vCPU, Lambda concurrency, và nhất là **quota của API bên ngoài** (NVD cho 5 request mỗi 30 s nếu không có key, 50 nếu có; ClearlyDefined và OSV có giới hạn batch). Không có rate limit thì một tenant upload 5 file stress test 200k component chiếm hết hàng đợi enrichment của mọi người (sự cố #16), một client retry storm lúc mạng chập chờn tự đánh sập API, và một đợt gọi ClearlyDefined quá tay làm cả batch bị từ chối, hàng nghìn dòng rơi vào [[enrichment_failed]] vĩnh viễn (sự cố #7). Rate limiting giải bốn việc: **fairness** giữa tenant, **bảo vệ backend** khỏi quá tải, **chống abuse**, và **tuân thủ quota** của người khác. Cần nhìn cả hai chiều: inbound (ai gọi mình) và outbound (mình gọi ai).

### Cốt lõi
#### Năm thuật toán, một bảng
| Thuật toán | Bộ nhớ mỗi key | Độ chính xác | Burst | Hợp với |
|---|---|---|---|---|
| Fixed window counter | 1 counter | kém ở biên cửa sổ: 2 lần limit trong 2 giây | có, không kiểm soát | thống kê thô, quota theo ngày |
| Sliding window log | O(limit) timestamp | chính xác tuyệt đối | không | limit nhỏ (10/phút), cần đúng từng request |
| Sliding window counter | 2 counter | sai số rất nhỏ (Cloudflare đo ~0,003% trên 400 triệu request) | mượt | mặc định cho API công khai |
| Token bucket | 2 số: tokens, last_ts | chính xác về tốc độ trung bình | cho phép tới dung lượng xô | API gateway, per-tenant, request có cost khác nhau |
| Leaky bucket | hàng đợi hoặc 2 số | đầu ra đều tuyệt đối | không, làm phẳng | traffic shaping khi gọi downstream |

- **Fixed window**: [[INCR rl:tenant:min:202610191432]] rồi [[EXPIRE 60]]. Rẻ nhất, nhưng 100 request ở giây 59 cộng 100 request ở giây 61 là 200 request trong 2 giây dù limit là 100/phút.
- **Sliding window log**: sorted set theo timestamp, [[ZREMRANGEBYSCORE]] bỏ phần cũ, [[ZCARD]] đếm. Đúng tuyệt đối nhưng limit 10 000/phút là 10 000 phần tử mỗi key.
- **Sliding window counter**: ước lượng = count_cửa_sổ_hiện_tại + count_cửa_sổ_trước × (phần cửa sổ trước còn chồng lên 60 s gần nhất). Hai counter, gần đúng, đủ cho hầu hết API.
- **Token bucket**: xô dung lượng B, nạp r token mỗi giây, request lấy [[cost]] token (1 cho GET, 20 cho upload 50 MB). Tính lười khi có request: [[tokens = min(B, tokens + (now - last) × r)]]; đủ thì trừ và cho qua. Ví dụ B = 100, r = 10/s: client im 30 s rồi gửi 100 request trong 1 giây vẫn được, sau đó đúng 10/s. Burst cho phép là tính năng, không phải lỗi.
- **Leaky bucket**: hàng đợi rò ra đều r request/s, đầy thì drop. Đầu ra phẳng tuyệt đối, hợp khi downstream cần tốc độ đều (gọi API ngoài). Nginx [[limit_req]] là leaky bucket với tham số [[burst]] và [[nodelay]].

#### Phân tán với Redis: atomic hay là sai
Hai instance cùng [[GET]] thấy 99, cùng tính "còn 1", cùng [[SET 100]] và cùng cho qua: đã vượt limit, và càng nhiều instance càng vượt nhiều. Mọi phép đọc-tính-ghi phải là **một thao tác atomic** trên Redis: Lua script (EVALSHA), hoặc [[INCR]] đơn lẻ cho fixed window, hoặc module như redis-cell.
~~~lua
-- KEYS[1] = bucket; ARGV: capacity, refill_per_ms, now_ms, cost
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local cap, rate, now, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local tokens = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate) * 2)
return allowed
~~~
- **Đồng hồ**: truyền [[now]] từ client thì skew giữa các instance làm xô "nạp nhanh" hay "nạp chậm"; an toàn hơn là gọi [[redis.call('TIME')]] trong script để mọi instance dùng cùng một đồng hồ.
- **Chi phí**: một round trip Redis trong DC ~0,2–0,5 ms; Redis đơn xử lý ~100 000 lệnh/s, đủ cho phần lớn API. Key có hash tag [[rl:{tenant42}:upload]] để cùng slot trên Redis Cluster.
- **Redis chết thì sao**: limiter bảo vệ backend khỏi quá tải nên **fail-open** (cho qua, chuyển sang limiter cục bộ trong process, log cảnh báo), vì mất Redis không được kéo theo mất toàn bộ dịch vụ. Limiter chống abuse hoặc gắn với billing thì **fail-closed**. Quyết định này phải nằm trong ADR, không để mặc định của thư viện quyết.

#### Đặt limiter ở đâu và theo khóa nào
:::diagram
Client[Client tenant A] -> Edge[Nginx limit_req theo IP]
Edge -> GW[Gateway token bucket theo API key] : Lua atomic
GW -> Redis[Redis counters]
GW -> API[apiserver middleware theo tenant và cost]
API -> DB[Postgres]
API -> Out[Outbound limiter theo upstream] : rate + concurrency
Out -> CD[ClearlyDefined]
Out -> NVD[NVD 50 request mỗi 30 s]
:::
- **Edge / gateway** (Nginx, Envoy, AWS API Gateway): chặn sớm, rẻ, theo IP hoặc API key; không biết tenant đang ở plan nào.
- **Middleware trong app**: biết tenant, plan, và **cost** của request; áp per-tenant, per-user, per-endpoint. Đây là nơi fairness được quyết định.
- **Phân tầng**: per-IP (chống abuse) → per-tenant (fairness theo plan) → per-endpoint đắt (upload, export) → global (bảo vệ DB). Mỗi tầng một mục đích, một chính sách fail riêng.
- **Nhiều gateway**: mỗi gateway giữ token bucket cục bộ và đồng bộ với Redis theo chu kỳ, hoặc "local trước, global sau": cho qua cục bộ tới limit/N rồi mới hỏi global. Chấp nhận sai số 5–10% để đổi lấy không có round trip Redis trên mọi request.
- **Per-IP có bẫy**: khách Nhật cả công ty đi ra một IP qua proxy; CDN và load balancer thay IP nguồn. Lấy IP từ [[X-Forwarded-For]] chỉ khi hop trước là của mình, nếu không client tự ghi header là qua mặt được.

#### Trả lời client thế nào
- **429 Too Many Requests** kèm [[Retry-After]] (giây hoặc HTTP date). Kèm [[X-RateLimit-Limit]], [[X-RateLimit-Remaining]], [[X-RateLimit-Reset]] (chuẩn de facto; IETF đang chuẩn hóa thành [[RateLimit-Policy]] và [[RateLimit]]). Trả header cả khi còn quota để client tự điều tiết trước khi bị chặn.
- **429 vs 503**: 429 là client vượt hạn mức của mình; 503 là server đang quá tải (load shedding), cũng kèm Retry-After. Trộn hai mã làm client không biết nên giảm tốc hay đổi endpoint.
- Client đúng mực: tôn trọng Retry-After, exponential backoff có jitter, không retry các 4xx khác. Server: không rate limit health check và internal call; whitelist theo service identity, không theo IP.

#### Chiều ra: gọi API ngoài không được "tay không"
- **Client-side limiter per upstream**: [[rate.NewLimiter(rate.Limit(1.6), 5)]] cho NVD (50 request mỗi 30 s), gọi [[Wait(ctx)]] trước mỗi call. Token bucket chờ thay vì từ chối thì chính là leaky bucket làm phẳng đầu ra.
- **Concurrency limit** là thứ khác: giới hạn số call **đồng thời** bằng semaphore ([[errgroup.SetLimit(10)]], buffered channel). Rate limit bảo vệ quota của upstream; concurrency limit bảo vệ RAM và goroutine của chính mình (sự cố #3: 10 goroutine mỗi goroutine preload 490k dòng). Cần cả hai.
- **Queue-based load leveling**: lúc burst không gọi thẳng, đẩy vào queue, worker kéo theo tốc độ cố định. Upload 200k component chia batch 100 là 2 000 call; với 50 call/s thì xong sau ~40 s, không chạm quota, không chết ai.
- **Batch an toàn** (sự cố #7): một coordinate "version-range" sai làm upstream từ chối cả batch 100. Hai lớp: validate input trước khi xếp batch (loại coordinate không hợp lệ thành [[no_locator]] ngay), và khi batch lỗi thì **bisect** (chia đôi, retry từng nửa) để cô lập dòng hỏng thay vì đánh dấu 100 dòng failed. Lỗi 429/5xx của upstream là lỗi tạm thời, retry có backoff; lỗi 4xx dữ liệu mới là failed có lý do.
- **Adaptive**: nhận 429 từ upstream thì giảm tốc theo AIMD (nhân 0,5, rồi cộng dần 10% mỗi phút không lỗi), luôn tôn trọng Retry-After. **Circuit breaker** là thứ khác nữa: mở khi tỉ lệ lỗi vượt ngưỡng, ngừng gọi trong cooldown, rồi half-open thử lại.

### Số liệu cần nhớ
| Con số | Giá trị | Ghi chú |
|---|---|---|
| Redis round trip | 0,2–0,5 ms trong DC; ~100 000 lệnh/s một node | đủ cho limiter tập trung của hầu hết API |
| Sliding window counter | sai số ~0,003% (Cloudflare) | 2 counter thay cho log đầy đủ |
| Fixed window | tối đa 2 × limit trong 2 giây ở biên | lý do không dùng cho bảo vệ backend |
| NVD API | 5 request mỗi 30 s không key; 50 mỗi 30 s có key | bắt buộc limiter phía client |
| Nginx limit_req | zone 10 MB giữ ~160 000 IP; burst + nodelay | leaky bucket tại edge |

### Sai lầm hay gặp
- GET rồi SET trên Redis: nhiều instance cùng cho qua; limiter "có cũng như không" dưới tải thật.
- Fixed window cho bảo vệ DB: burst gấp đôi đúng lúc cần bảo vệ nhất.
- Per-IP sau NAT hoặc CDN: chặn nhầm cả công ty khách; hoặc tin [[X-Forwarded-For]] do client tự ghi.
- Không trả Retry-After, client retry ngay lập tức: thundering herd ngay sau khi hết cửa sổ.
- Fail-closed cho limiter bảo vệ backend: Redis chết là toàn bộ API trả 429.
- Cost = 1 cho mọi request: 100 GET health bằng 100 lần upload 50 MB.
- Chỉ rate limit mà không concurrency limit: tốc độ đúng nhưng 10 goroutine cùng giữ hàng trăm MB (#3).
- Outbound không limiter, 429 của upstream bị xử lý như lỗi dữ liệu và ghi failed vĩnh viễn; batch lỗi đánh dấu cả 100 dòng thay vì bisect (#7).
- Rate limit cả health check, readiness probe: load balancer rút instance khỏe ra khỏi pool.

### Nói thế nào trong phỏng vấn (EN)
- "I would use a token bucket per tenant: it allows a controlled burst up to the bucket size while enforcing the average rate, and it only needs two numbers per key." — Token bucket per tenant: cho burst có kiểm soát, giữ tốc độ trung bình, chỉ cần 2 số mỗi key.
- "The check must be atomic on Redis, a Lua script or a single INCR; a GET then SET from multiple instances will overshoot the limit." — Phép kiểm tra phải atomic trên Redis; GET rồi SET từ nhiều instance sẽ vượt limit.
- "If Redis is down, a limiter that protects the backend should fail open to a local limiter; one that protects billing or abuse should fail closed." — Redis chết thì limiter bảo vệ backend fail-open sang cục bộ; limiter cho billing/abuse fail-closed.
- "Return 429 with Retry-After and the X-RateLimit headers even on success, so well-behaved clients slow down before they get blocked." — Trả 429 với Retry-After và header X-RateLimit cả khi thành công để client tự giảm tốc.
- "For outbound calls I combine a client-side rate limiter per upstream with a concurrency semaphore and a queue, and I bisect failed batches instead of failing every item." — Gọi ra ngoài: limiter per upstream + semaphore + queue, bisect batch lỗi thay vì fail cả batch.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Sự cố #7 và #16 có chung lời giải ở chiều ra: một package [[upstream]] với limiter per upstream dùng [[golang.org/x/time/rate]] (NVD 50 request mỗi 30 s có key, ClearlyDefined và OSV theo tài liệu của họ), semaphore 5–10 call đồng thời, và retry có backoff cho 429/5xx. Lambda enrichment hiện gọi theo batch: thêm validate coordinate trước khi xếp batch, batch lỗi thì bisect; dòng nào thật sự sai mới ghi [[enrichment_failed]] kèm [[fail_reason]].
- Fairness giữa tenant cho enrichment: thay vì "100 dòng pending cũ nhất" (sự cố #8), sweeper lấy theo round-robin tenant với token bucket mỗi tenant (ví dụ 2 000 component/phút/tenant); 5 file stress test của một tenant không còn chiếm hết hàng đợi của khách khác.
- Inbound ở apiserver: middleware token bucket per tenant trên Redis bằng Lua script, cost theo endpoint (upload 20, export 10, GET 1); trả 429 kèm Retry-After và X-RateLimit-*. Fail-open sang limiter cục bộ nếu Redis không trả lời trong 20 ms, log cảnh báo; Redis trên Lambda từng mất env (sự cố #2) nên đừng để limiter chết kéo theo API.
- Export (sự cố #11) là endpoint đắt: ngoài rate limit, giới hạn 2 export đồng thời mỗi tenant bằng semaphore trong Redis ([[INCR]] với TTL, giảm khi xong), quá thì 429 với Retry-After 30.
- Policy evaluation (sự cố #6): 238 policy chạy liên tục là một dạng "không có limiter nội bộ"; đặt concurrency limit cho eval và tốc độ tối đa theo phút để DB 4 vCPU không bị ghim 100%.
- Đo trước khi chọn số: log 1 tuần số request mỗi tenant mỗi phút (p50, p99, max) và thời gian từng loại request, chọn limit ở khoảng 2–3 lần p99 của tenant bình thường; đừng đoán.
- Phía khách: tài liệu API ghi rõ limit theo plan, ý nghĩa header X-RateLimit-* và Retry-After; SDK/CLI mẫu có backoff kèm jitter. Khách Nhật rất hay mở ticket "bị 429 không rõ lý do" nếu header không có.
- ADR gợi ý: "Rate limiting SBOM: token bucket per tenant tại middleware, Lua atomic trên Redis, fail-open cho bảo vệ backend; outbound bắt buộc qua package upstream có rate + concurrency + bisect". Kèm bảng limit theo plan và cách client đọc header.
`,
  quiz: [
    { t: 'mc', q: 'Điểm yếu đặc trưng của fixed window counter là gì?', o: ['Tốn bộ nhớ O(limit) mỗi key', 'Không chạy được trên Redis Cluster', 'Không cho phép burst nào', 'Cho phép tới 2 lần limit trong khoảng ngắn quanh biên cửa sổ'], a: 3, why: 'Cuối cửa sổ trước và đầu cửa sổ sau đều được dùng hết limit, nên 2 × limit có thể lọt trong vài giây.' },
    { t: 'mc', q: 'Token bucket dung lượng 100, nạp 10 token/s. Client im lặng 30 giây rồi gửi 150 request trong 1 giây. Kết quả gần đúng?', o: ['Cả 150 được chấp nhận vì đã tích lũy 300 token', '100 được chấp nhận ngay, ~10 nữa trong giây đó, phần còn lại bị từ chối', 'Chỉ 10 được chấp nhận vì tốc độ là 10/s', 'Tất cả bị từ chối vì vượt burst'], a: 1, why: 'Xô chỉ chứa tối đa 100 token dù im lặng bao lâu; sau burst, tốc độ về đúng 10/s.' },
    { t: 'mc', q: 'Vì sao limiter phân tán trên Redis phải dùng Lua script hoặc một lệnh atomic?', o: ['Vì GET rồi SET từ nhiều instance đọc cùng giá trị cũ và đều cho qua, vượt limit', 'Vì Redis không hỗ trợ EXPIRE trên hash', 'Vì Lua nhanh hơn pipeline', 'Vì Redis Cluster yêu cầu mọi lệnh phải là script'], a: 0, why: 'Đọc-tính-ghi không atomic là race condition kinh điển; càng nhiều instance càng vượt nhiều.' },
    { t: 'mc', q: 'Limiter per-tenant của bạn chỉ nhằm bảo vệ Postgres khỏi quá tải. Redis chứa counter bị chết. Hành vi hợp lý nhất?', o: ['Trả 429 cho mọi request tới khi Redis sống lại', 'Trả 503 toàn bộ', 'Fail-open: cho qua và chuyển sang limiter cục bộ trong process, log cảnh báo', 'Tắt limiter vĩnh viễn và báo on-call'], a: 2, why: 'Mục đích là bảo vệ backend, không phải chặn client; mất Redis không được kéo theo mất toàn bộ dịch vụ.' },
    { t: 'mc', q: 'Gọi API ngoài theo batch 100 coordinate; một coordinate sai làm upstream từ chối cả batch. Cách xử lý tốt nhất?', o: ['Đánh dấu cả 100 dòng là failed để không gọi lại', 'Validate coordinate trước khi xếp batch và bisect batch lỗi để cô lập dòng hỏng', 'Giảm batch xuống 1 coordinate mỗi request', 'Retry cả batch 5 lần với backoff'], a: 1, why: 'Batch 1 phá quota, retry nguyên batch lặp lại lỗi; validate trước và bisect là cách giữ throughput mà vẫn tìm đúng dòng hỏng.' },
    { t: 'fill', q: 'Điền: thuật toán rate limit cho phép burst tới dung lượng xô và nạp lại đều theo thời gian gọi là ___ bucket.', a: ['token', 'token bucket'], why: 'Token bucket giữ hai số (tokens, last_ts), cho burst có kiểm soát và tốc độ trung bình cố định.' },
    { t: 'fill', q: 'Điền: header HTTP đi kèm mã 429 báo client nên chờ bao lâu trước khi thử lại là ___.', a: ['retry-after', 'retry after'], why: 'Không có Retry-After, client retry ngay và tạo thundering herd đúng lúc hết cửa sổ.' },
    { t: 'open', q: 'Thiết kế rate limiting cho SaaS multi-tenant có API upload nặng và phải gọi API bên thứ ba có quota. Nêu thuật toán, nơi đặt, khóa, hành vi khi Redis chết, và chiều gọi ra ngoài.', a: 'Inbound: token bucket per tenant trong middleware (biết plan và cost từng endpoint), counter trên Redis cập nhật bằng Lua atomic, thêm tầng per-IP ở edge chống abuse. Trả 429 với Retry-After và X-RateLimit headers. Redis chết thì fail-open sang limiter cục bộ vì mục đích là bảo vệ backend. Outbound: client-side rate limiter per upstream theo quota của họ, concurrency semaphore để bảo vệ RAM, queue-based leveling để burst upload không thành burst gọi ngoài, retry backoff cho 429/5xx, bisect batch lỗi. Đo p99 request mỗi tenant trước khi chọn số.', keys: ['token bucket', 'per tenant', 'atomic', 'fail-open', 'concurrency'] }
  ]
},
{ id: 'B10', type: 'block', topic: 'data', title: 'Sinh ID duy nhất, thời gian và thứ tự: UUID v4/v7, Snowflake, ULID, ticket server; clock skew, Lamport, HLC', time: '110 phút',
  goal: 'Chọn được kiểu ID cho từng bảng theo 5 tiêu chí (unique, sortable, kích thước, lộ thông tin, sinh offline) và giải thích chi phí index của UUID v4; trình bày Snowflake đến từng bit và cách xử lý clock going backwards; phân biệt wall clock, monotonic clock, Lamport, vector clock, HLC và biết khi nào cần cái nào.',
  md: `
### Vấn đề cần giải
Trong một Postgres duy nhất, [[bigserial]] là đủ. Vấn đề bắt đầu khi ID phải sinh ở **nhiều nơi không điều phối** (nhiều shard, nhiều instance, Lambda sinh ID trước khi insert, client sinh idempotency key), khi ID phải **sắp xếp được theo thời gian** (cursor pagination, index locality), khi ID **không được lộ thông tin** (số đơn hàng tăng dần cho đối thủ biết doanh số, ID đoán được dẫn tới IDOR), và khi ID phải **nhỏ** để index trăm triệu dòng không phình. Thời gian cũng không đáng tin như tưởng: đồng hồ hai máy lệch nhau (clock skew) vài ms trong DC, hàng trăm ms qua internet; NTP có thể nhảy lùi; so sánh timestamp của hai máy để quyết "cái nào trước" là sai về nguyên lý. Bài này đi từ ID sang thời gian sang thứ tự, vì ba thứ ràng nhau: ID sortable dựa vào clock, clock không tin được thì phải có logical clock.

### Cốt lõi
#### Năm tiêu chí và bảng so sánh
| Kiểu ID | Kích thước | Sortable theo thời gian | Sinh không điều phối | Lộ thông tin | Chi phí index |
|---|---|---|---|---|---|
| Auto-increment / sequence | 8 byte | có (gần đúng) | không, gắn một DB | lộ số lượng và tốc độ | tốt nhất, append cuối B-tree |
| Ticket server (Flickr) | 8 byte | có | không, cần gọi server | lộ như trên | tốt |
| UUID v4 | 16 byte (36 ký tự dạng text) | không | có | không | kém: insert ngẫu nhiên vào B-tree |
| UUID v7 / ULID | 16 byte | có, theo ms | có | lộ thời điểm tạo | tốt, gần append |
| Snowflake | 8 byte | có, theo ms | có, cần machine id duy nhất | lộ thời điểm và một phần tốc độ | tốt nhất |
| Hash nội dung (sha256) | 32 byte | không | có, deterministic | không | kém, nhưng dedup tự nhiên |

#### Auto-increment, multi-master và ticket server
- Sequence của Postgres nhanh và sortable, nhưng gắn chặt một DB. Với sequence có [[CACHE]] hoặc nhiều connection, giá trị không liên tục và không phản ánh đúng thứ tự commit; đừng dùng "id lớn hơn là commit sau" để sync dữ liệu.
- Multi-master kiểu offset: node A sinh số lẻ, node B số chẵn (MySQL [[auto_increment_increment]], [[auto_increment_offset]]). Chạy được với 2–3 node, thêm node thứ tư là đổi cấu hình toàn bộ; không ai làm quá 3.
- **Ticket server** (Flickr): một MySQL với bảng một hàng, [[REPLACE INTO tickets (stub) VALUES ('a')]] rồi [[LAST_INSERT_ID()]]; hai server lẻ/chẵn cho HA. Đơn giản, nhưng mỗi ID là một round trip (~0,5 ms) và là một điểm phụ thuộc chung. Cải tiến phổ biến: cấp **range** (segment) 1 000 ID một lần cho mỗi instance, dùng dần trong RAM; mất range khi restart chấp nhận được.
- Lộ thông tin: [[/invoices/10452]] cho biết bạn có khoảng 10 000 hóa đơn và tốc độ tăng mỗi ngày (bài toán xe tăng Đức). Giữ bigint nội bộ, phơi ra ngoài một public id riêng (UUID hoặc chuỗi ngẫu nhiên).

#### UUID v4 và cái giá của ngẫu nhiên
- 122 bit ngẫu nhiên; cần sinh ~2^61 ID (2,3 tỷ tỷ) để xác suất va chạm đạt 50%: va chạm không phải vấn đề.
- Vấn đề là **index locality**: giá trị ngẫu nhiên chèn vào vị trí ngẫu nhiên của B-tree, mọi insert chạm một page khác nhau. Khi index lớn hơn RAM: cache miss, page split, WAL nhiều hơn; insert có thể chậm 2–4 lần so với khóa tăng dần trên Postgres, tệ hơn nhiều trên InnoDB vì PK là clustered index. Lưu dạng text 36 ký tự thay vì kiểu [[uuid]] 16 byte là tự làm index to gấp đôi lần nữa.
- Dùng v4 khi: không cần sortable, bảng nhỏ hoặc ghi ít, cần không đoán được (token, idempotency key, public id).

#### UUID v7 và ULID: ngẫu nhiên nhưng có thứ tự
- **UUID v7** (RFC 9562, 2024): 48 bit Unix time ms + 12 bit (counter hoặc random) + 62 bit random; giữ nguyên định dạng UUID nên đổi từ v4 không cần đổi schema. Postgres 18 có [[uuidv7()]]; Go dùng [[uuid.NewV7()]] của google/uuid. Trong cùng một ms có thể không đơn điệu nếu không bật counter.
- **ULID**: 48 bit ms + 80 bit random, mã hóa Crockford base32 thành 26 ký tự URL-safe, có chế độ monotonic (tăng phần random trong cùng ms). Lưu được vào cột [[uuid]] vì cùng 128 bit.
- Trả giá: lộ thời điểm tạo (thường chấp nhận); 16 byte thay vì 8; phụ thuộc wall clock của máy sinh nên hai máy lệch giờ sinh ID "lộn thứ tự" trong khoảng lệch đó.

#### Snowflake: 64 bit đủ dùng cho 69 năm
- Bố cục gốc của Twitter: 1 bit dấu (luôn 0) + **41 bit** ms kể từ epoch tùy chọn (2^41 ms ≈ 69 năm) + **10 bit** machine id (1 024 node) + **12 bit** sequence (4 096 ID mỗi ms mỗi node, tức ~4 triệu ID/s/node). Sequence tràn trong một ms thì spin chờ sang ms kế.
- **Machine id** là điểm chết người: hai node cùng id là trùng ID im lặng. Cấp từ etcd/ZooKeeper (lease, B6), từ ordinal của StatefulSet, hoặc từ bảng [[machine_ids]] trong Postgres có heartbeat; không hard-code trong env rồi scale replica.
- **Clock going backwards**: NTP step lùi 200 ms thì generator thấy [[now < last_ts]] và có thể sinh lại ID đã cấp. Cách xử lý theo thứ tự ưu tiên: (1) lệch nhỏ (dưới vài ms) thì **chờ** tới khi clock vượt [[last_ts]]; (2) lệch lớn thì **từ chối sinh** và alert thay vì cấp ID sai; (3) hoặc dùng logical fallback: coi [[ts = last_ts]] và tiếp tục tăng sequence cho tới khi wall clock đuổi kịp; (4) đo thời gian trôi bằng **monotonic clock** cộng với mốc wall clock lấy một lần lúc khởi động, để NTP step không ảnh hưởng trong phiên chạy.
- Biến thể: Sonyflake (39 bit đơn vị 10 ms + 8 bit sequence + 16 bit machine: nhiều máy hơn, ít ID/s hơn); Instagram sinh ngay trong Postgres bằng PL/pgSQL với 41 bit ms + 13 bit **shard id** + 10 bit sequence, nên nhìn ID là biết hàng nằm ở shard nào.

:::diagram
Clock[Wall clock ms 41 bit] -> ID[Snowflake 64 bit]
Machine[Machine id 10 bit từ etcd lease] -> ID
Seq[Sequence 12 bit mỗi ms] -> ID
Mono[Monotonic clock đo elapsed] -> Clock : chống NTP step
ID -> PK[Primary key bigint]
ID -> Cursor[Cursor pagination]
ID -> Shard[Shard id lấy từ bit machine]
:::

#### Thời gian: hai loại đồng hồ, hai việc khác nhau
- **Wall clock** (time-of-day) do NTP chỉnh: sai số vài ms trong DC, 10–100 ms qua internet; có thể **nhảy** (step) cả hai chiều, có leap second (các cloud lớn "smear" trong 24 giờ). Dùng để hiển thị, ghi [[created_at]], không bao giờ để quyết định thứ tự giữa hai máy.
- **Monotonic clock** chỉ tiến, không có ý nghĩa tuyệt đối, dùng để đo **khoảng**: timeout, lease, latency. Trong Go, [[time.Now()]] mang cả hai; [[time.Since]] và so sánh [[Before/After]] dùng phần monotonic nếu còn; các phép [[Round]], [[Truncate]], [[UnixNano]] hoặc đi qua JSON làm mất nó.
- Hậu quả của skew: lease hết sớm (B6), cache TTL sai, JWT [[nbf]] bị từ chối, **last-write-wins** ở Cassandra/DynamoDB mất bản ghi của máy chạy chậm giờ, log hai service đảo thứ tự. Google TrueTime (GPS + đồng hồ nguyên tử) chỉ thu hẹp độ bất định ε về ~1–7 ms và Spanner **chờ hết ε** trước khi commit; không ai khác có cái đó, nên cần logical clock.

#### Lamport, vector clock, HLC
- **Lamport timestamp**: mỗi node giữ một counter; event cục bộ thì +1; gửi message kèm counter; nhận thì [[max(local, received) + 1]]. Bảo đảm: nếu a xảy ra trước b (happens-before) thì L(a) < L(b). Chiều ngược **không** đúng: L(a) < L(b) không có nghĩa a trước b, có thể là hai event đồng thời. Total order khi cần: so (L, node_id).
- **Vector clock**: mảng counter, một ô mỗi node; so sánh được hai event là trước-sau hay **đồng thời**, nên phát hiện được conflict (Dynamo, Riak). Giá: O(n) theo số node, phải cắt tỉa.
- **HLC** (hybrid logical clock): cặp (physical ms, logical counter). Khi có event: [[l = max(l_cũ, pt_now, l_nhận)]]; nếu l không đổi thì tăng counter, đổi thì counter về 0. Giữ happens-before như Lamport nhưng phần vật lý gần wall clock nên **đọc ra được thời gian thật**, gói vừa 64 bit. CockroachDB và YugabyteDB dùng HLC; CockroachDB kick node lệch quá [[max-offset]] 500 ms ra khỏi cluster.

:::diagram
A1[A: upload, L=1] -> B2[B: enrich, L=max(1,0)+1=2] : message kèm L=1
B2 -> C3[C: policy eval, L=max(2,1)+1=3] : message kèm L=2
C0[C: event cục bộ, L=1] -> C3
:::

| Đồng hồ | Đọc được thời gian thật | Giữ happens-before | Phát hiện đồng thời | Kích thước |
|---|---|---|---|---|
| Wall clock | có | không (skew) | không | 8 byte |
| Monotonic | không, chỉ đo khoảng | chỉ trong một process | không | 8 byte |
| Lamport | không | có | không | 8 byte |
| Vector clock | không | có | có | 8 byte × số node |
| HLC | gần đúng (ms) | có | không | 8 byte |

#### Dùng ID cho ba việc quen thuộc
- **Idempotency key** (B7): client sinh UUID v4, không cần sortable, cần không đoán được; server lưu 24 giờ.
- **Cursor pagination**: với ID sortable (v7, Snowflake) chỉ cần [[WHERE id > $cursor ORDER BY id LIMIT 100]], mỗi trang một index seek, không OFFSET quét lại từ đầu (sự cố #11). Nếu phải sort theo [[created_at]] thì cursor là cặp [[(created_at, id)]] và điều kiện [[(created_at, id) > ($1, $2)]] để tie-break.
- **Sharding**: lấy shard từ bit trong ID (kiểu Instagram) để route không cần tra bảng; hoặc dùng tenant_id làm khóa shard và ID chỉ cần unique trong tenant. Trong Postgres: PK [[bigint]] 8 byte là lựa chọn index tốt nhất; [[uuid]] 16 byte chấp nhận được; text 36 ký tự thì không.

### Số liệu cần nhớ
| Con số | Giá trị | Ghi chú |
|---|---|---|
| UUID v4 va chạm 50% | sau ~2^61 ID | không phải vấn đề thực tế |
| Snowflake | 41 bit ms ≈ 69 năm; 1 024 node; 4 096 ID/ms/node | sequence tràn thì chờ ms kế |
| ULID | 128 bit, 26 ký tự base32, 1,21 × 10^24 ID mỗi ms | có chế độ monotonic |
| NTP skew | vài ms trong DC, 10–100 ms qua internet; có thể step lùi | không so thứ tự bằng wall clock |
| TrueTime ε / CockroachDB max-offset | ~1–7 ms / 500 ms | Spanner chờ hết ε; CRDB kick node lệch |
| bigint vs uuid vs text UUID | 8 vs 16 vs 36 byte mỗi giá trị index | nhân với số dòng và số index |

### Sai lầm hay gặp
- UUID v4 làm PK bảng trăm triệu dòng, lại lưu dạng text: index gấp 4–5 lần bigint, insert chậm, cache miss liên tục.
- Phơi auto-increment ra public API: lộ quy mô kinh doanh và mở đường IDOR.
- Snowflake machine id lấy từ env tĩnh rồi scale 3 replica: trùng ID im lặng tới khi unique violation hoặc tệ hơn là ghi đè.
- Dùng [[created_at]] của hai máy để quyết định bản nào mới hơn (LWW); mất dữ liệu khi một máy chậm giờ 2 giây.
- Dùng wall clock cho timeout và lease: NTP step làm lease hết sớm hoặc không bao giờ hết.
- Cursor pagination theo [[created_at]] không tie-break: mất hoặc trùng dòng khi nhiều dòng cùng giây.
- Cột [[timestamp without time zone]] khi server ở JST, DB ở UTC, người dùng ở Việt Nam: lệch 7–9 giờ không ai giải thích được. Luôn [[timestamptz]].
- Nghĩ Lamport timestamp cho biết "a trước b" khi L(a) < L(b); nó chỉ cho chiều ngược lại.

### Nói thế nào trong phỏng vấn (EN)
- "I would use a time-ordered 64-bit ID like Snowflake, or UUID v7 if I need the UUID format; random UUID v4 as a primary key hurts B-tree locality on large tables." — Dùng ID 64 bit có thứ tự thời gian như Snowflake, hoặc UUID v7 nếu cần định dạng UUID; v4 làm PK hại locality của B-tree.
- "Snowflake packs 41 bits of milliseconds, 10 bits of machine id and 12 bits of sequence; the machine id must come from a coordination service, and the generator must refuse or wait when the clock goes backwards." — Snowflake gồm 41 bit ms, 10 bit machine, 12 bit sequence; machine id từ dịch vụ điều phối; clock lùi thì từ chối hoặc chờ.
- "Wall clocks are for display; for timeouts and leases I use the monotonic clock, and for ordering across nodes I use a logical clock such as Lamport or HLC." — Wall clock để hiển thị; timeout/lease dùng monotonic; thứ tự giữa node dùng logical clock.
- "Lamport timestamps preserve happens-before but cannot tell concurrent events apart; vector clocks can, at O(n) cost; HLC keeps Lamport guarantees while staying close to real time." — Lamport giữ happens-before nhưng không nhận ra đồng thời; vector clock nhận ra với chi phí O(n); HLC giữ bảo đảm Lamport mà gần thời gian thật.
- "Time-ordered IDs also give me cheap cursor pagination: WHERE id greater than cursor, no OFFSET." — ID có thứ tự thời gian cho cursor pagination rẻ, không OFFSET.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Kiểm kê PK hiện tại: bảng nào dùng UUID v4, lưu kiểu [[uuid]] hay text, bảng nào trăm triệu dòng (t_components, policy violation 9,6 triệu dòng ở sự cố #6). Với bảng lớn ghi nhiều, đề xuất PK [[bigint]] Snowflake hoặc UUID v7 cho bảng mới; bảng cũ không migrate PK, nhưng thêm cột v7/thời gian cho cursor.
- Export (sự cố #11) đang OFFSET: chuyển sang cursor theo [[(created_at, id)]] hoặc theo ID có thứ tự thời gian; mỗi trang một index seek; kết hợp stream ra response thay vì ReadAll vào RAM.
- Lambda enrichment sinh bản ghi theo batch: sinh ID trên Lambda bằng UUID v7 (không cần round trip DB, vẫn gần append trong index) rồi [[COPY]] hoặc multi-row insert; không dùng sequence qua FDW.
- Sự cố #15 (first-writer-wins) và #14 (reconcile wipe) đều là bài toán thứ tự: so sánh [[updated_at]] giữa Lambda và worker là so wall clock của hai máy khác nhau. Thay bằng [[revision]] hoặc counter tăng đơn điệu do Postgres cấp ([[xmin]] hoặc cột version) làm điều kiện ghi: [[UPDATE ... WHERE version = $expected]].
- Lease và timeout trong worker (sweeper budget 60 s ở sự cố #8, lock của B6): dùng [[time.Since]] trên giá trị [[time.Now()]] gốc (còn monotonic), không lưu Unix timestamp rồi trừ; kiểm tra chỗ nào serialize deadline qua JSON hay Redis rồi so sánh lại.
- Public API: endpoint nào đang phơi bigint tuần tự ra ngoài (project id, revision id)? Thêm public id không đoán được hoặc ít nhất kiểm tra tenant ở mọi truy cập theo id (IDOR).
- Snowflake machine id nếu áp dụng: cấp từ bảng [[machine_ids]] trong Postgres với heartbeat 30 s, hoặc từ ordinal container; viết test sinh 1 triệu ID trên 3 goroutine, assert không trùng và tăng đơn điệu theo từng generator.
- ADR gợi ý: "ID trong SBOM: bảng mới dùng UUID v7 lưu kiểu uuid; không so thứ tự bằng timestamp giữa service; mọi cột thời gian là timestamptz; cursor pagination là mặc định cho list và export".
`,
  quiz: [
    { t: 'mc', q: 'Vì sao UUID v4 làm primary key gây hại hiệu năng trên bảng lớn?', o: ['Vì xác suất va chạm cao', 'Vì UUID không index được', 'Vì giá trị ngẫu nhiên chèn vào vị trí ngẫu nhiên của B-tree gây page split và cache miss khi index lớn hơn RAM', 'Vì Postgres phải chuyển UUID sang text để so sánh'], a: 2, why: 'Va chạm không phải vấn đề (2^61 ID mới đạt 50%); vấn đề là index locality.' },
    { t: 'mc', q: 'Generator Snowflake phát hiện đồng hồ hệ thống vừa lùi 300 ms so với last_ts. Hành vi đúng?', o: ['Chờ hoặc từ chối sinh ID và alert; không cấp ID có thể trùng với ID đã cấp', 'Sinh ID với timestamp hiện tại vì sequence sẽ phân biệt', 'Đổi machine id tạm thời', 'Dùng random thay cho sequence'], a: 0, why: 'ID đã cấp trong 300 ms đó có thể bị sinh lại; an toàn là chờ clock đuổi kịp hoặc từ chối, hoặc giữ ts = last_ts và tăng sequence.' },
    { t: 'mc', q: 'Lamport timestamp bảo đảm điều gì?', o: ['L(a) < L(b) suy ra a xảy ra trước b', 'Hai event đồng thời luôn có L bằng nhau', 'L phản ánh thời gian thật tới ms', 'Nếu a happens-before b thì L(a) < L(b); chiều ngược lại không đúng'], a: 3, why: 'Lamport giữ happens-before nhưng không phân biệt được event đồng thời; cần vector clock cho việc đó.' },
    { t: 'mc', q: 'Export 2 triệu dòng đang dùng OFFSET và ngày càng chậm ở trang sau. Cách sửa đúng?', o: ['Tăng LIMIT lên 10 000 mỗi trang', 'Cursor pagination: WHERE (created_at, id) > ($1, $2) ORDER BY created_at, id LIMIT n, hoặc theo ID có thứ tự thời gian', 'Thêm index trên OFFSET', 'Cache toàn bộ kết quả vào Redis'], a: 1, why: 'OFFSET phải quét và bỏ qua mọi dòng trước đó; cursor biến mỗi trang thành một index seek.' },
    { t: 'mc', q: 'Khác biệt chính của HLC so với Lamport timestamp?', o: ['HLC phát hiện được event đồng thời', 'HLC cần O(n) bộ nhớ theo số node', 'HLC giữ happens-before nhưng phần vật lý gần wall clock nên đọc ra được thời gian thật trong 64 bit', 'HLC không cần trao đổi timestamp qua message'], a: 2, why: 'HLC là cặp (physical, logical); vẫn không phát hiện đồng thời (đó là vector clock) nhưng mang ý nghĩa thời gian.' },
    { t: 'fill', q: 'Điền: định danh 128 bit gồm 48 bit ms và 80 bit ngẫu nhiên, mã hóa thành 26 ký tự Crockford base32, gọi là ___.', a: ['ulid'], why: 'ULID sortable theo thời gian, URL-safe, lưu được vào cột uuid vì cùng 128 bit.' },
    { t: 'fill', q: 'Điền: loại đồng hồ chỉ tiến, không có ý nghĩa tuyệt đối, dùng để đo timeout và lease, gọi là ___ clock.', a: ['monotonic', 'monotonic clock'], why: 'Wall clock có thể bị NTP step lùi; monotonic clock không, nên mọi phép đo khoảng thời gian phải dùng nó.' },
    { t: 'open', q: 'Thiết kế cách sinh ID cho bảng component của SaaS multi-tenant: insert hàng trăm nghìn dòng mỗi lần từ nhiều worker và Lambda, cần cursor pagination và không được lộ quy mô cho khách. Nêu lựa chọn, lý do, và cách xử lý đồng hồ.', a: 'Dùng UUID v7 (hoặc Snowflake 64 bit nếu muốn PK 8 byte) sinh ngay tại worker/Lambda để không cần round trip DB và vẫn gần append trong B-tree; lưu kiểu uuid 16 byte, không text. Cursor pagination theo id vì ID có thứ tự thời gian, không OFFSET. Không phơi bigint tuần tự ra ngoài; v7 lộ thời điểm tạo nhưng không lộ số lượng. Với Snowflake, machine id cấp từ etcd lease hoặc bảng có heartbeat; khi clock lùi thì chờ hoặc từ chối, dùng monotonic clock để đo elapsed. Thứ tự giữa các service không dựa vào timestamp của ID mà dựa vào revision do Postgres cấp.', keys: ['uuid v7', 'sortable', 'cursor', 'machine id', 'monotonic'] }
  ]
},
];
