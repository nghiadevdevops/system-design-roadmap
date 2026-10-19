/* ===== Giai đoạn 1 · Nền tảng (tuần 1–5) — 10 bài foundation F1–F10 =====
   Người học: backend Go ~5 năm, hệ thống SBOM multi-tenant (apiserver + worker Go, Postgres/FDW, Redis,
   RabbitMQ, Lambda enrichment, docker-compose + Watchtower, gocron). Mục "Áp dụng" bám sự cố thật. */
window.LESSONS_F = [
{ id: 'F1', type: 'foundation', topic: 'design', title: 'Tư duy system design: yêu cầu, trade-off và những con số phải thuộc', time: '90 phút',
  goal: 'Phân biệt functional/non-functional requirement, nêu được trade-off của bất kỳ lựa chọn kiến trúc nào, và thuộc ~15 con số latency, powers of two, availability nines để ước lượng trong 30 giây.',
  md: `
### Vấn đề cần giải
Đề bài system design luôn mơ hồ: "Design Twitter", "hệ thống SBOM chịu 10 000 tenant". Nếu bắt đầu vẽ hộp ngay, bạn đang thiết kế cho một hệ thống tưởng tượng. Việc đầu tiên là biến mơ hồ thành **yêu cầu đo được**, rồi chọn kiến trúc **vừa đủ** dưới ràng buộc latency, availability, consistency, cost. Phỏng vấn system design không chấm đúng/sai; nó chấm cách bạn làm rõ yêu cầu, ước lượng, chọn trade-off có lý do, và tự chỉ ra điểm yếu của thiết kế mình. Trong công việc, kỹ năng này quyết định bạn có nhìn ra "bảng 9,6 triệu dòng chỉ có index PK" là một quả bom hẹn giờ hay không.

### Cốt lõi
#### System design là gì và không là gì
- **Là**: đi từ yêu cầu mơ hồ → yêu cầu đo được → kiến trúc (thành phần, luồng dữ liệu, cách giao tiếp) → điểm nóng và cách xử lý → chi phí vận hành. Nó là kỹ năng *ra quyết định dưới ràng buộc*.
- **Không là**: chọn framework, vẽ sơ đồ thật nhiều hộp, học thuộc kiến trúc Netflix, hay viết code. Cũng không phải "dùng microservice + Kafka là scale".
- **Không có silver bullet**: mọi lựa chọn là trade-off. Cache nhanh hơn nhưng stale (dữ liệu cũ); read replica tăng đọc nhưng có replication lag; microservice tách đội nhưng thêm network hop, thêm failure mode; strong consistency đúng nhưng chậm và khó sẵn sàng khi partition.
- Câu hỏi bắt buộc cho mọi khái niệm: *nó giải quyết vấn đề gì, trả giá bằng gì, khi nào KHÔNG dùng*. Người trả lời được 3 câu này là senior; người chỉ biết "nó là gì" là junior.

#### Functional vs non-functional requirements
| Loại | Trả lời câu hỏi | Ví dụ với hệ thống SBOM |
|---|---|---|
| Functional | Hệ thống **làm gì** | Upload CycloneDX/SPDX, xem component, enrich license/vulnerability, đánh giá policy, gửi notification |
| Non-functional | Hệ thống làm việc đó **tốt đến đâu** | p95 danh sách component ≤ 5 s, 99,9% availability, enrichment xong trong 15 phút, dữ liệu tenant không lộ sang tenant khác |

Các trục non-functional phải hỏi (và ghi số):
| Trục | Câu hỏi cụ thể | Ghi chú |
|---|---|---|
| Latency | p50/p95/p99 bao nhiêu cho đọc, cho ghi? | Không dùng average: average 200 ms có thể che p99 = 8 s |
| Availability | Bao nhiêu "nines"? Downtime chấp nhận/tháng? | Quyết định redundancy, multi-AZ, chi phí |
| Consistency | Đọc sau ghi phải thấy ngay? Cũ vài giây được không? | Strong vs eventual; read-your-writes |
| Durability | Mất dữ liệu nào thì chết? RPO (mất tối đa bao nhiêu phút dữ liệu)? | Audit log ≠ cache |
| Scalability | DAU, QPS, tốc độ tăng dữ liệu/năm, tenant lớn nhất bao nhiêu? | Thiết kế cho 10× hiện tại, không phải 1 000× |
| Cost | Ngân sách hạ tầng, số người vận hành? | Kiến trúc đẹp mà 3 người ops không nổi là sai |
| Security / tenancy | Ai thấy gì? Dữ liệu dùng chung giữa tenant thế nào? | Sự cố #15: first-writer-wins làm leak license cross-tenant |

#### Cách đọc một sơ đồ kiến trúc
Đi theo luồng request: client → edge (DNS/CDN/LB) → tầng stateless (API) → tầng stateful (DB, cache, queue) → tầng bất đồng bộ (worker, cron, Lambda). Với **mỗi mũi tên** hỏi 4 câu: đồng bộ hay bất đồng bộ? timeout bao nhiêu? nếu đích chết thì nguồn làm gì? dữ liệu gì đi qua và bao nhiêu mỗi giây? Với **mỗi hộp** hỏi: stateless hay stateful? scale bằng cách nào? có phải single point of failure (SPOF) không?
Điểm nóng thường nằm ở 3 chỗ: nơi **gộp** mọi traffic (DB primary, hot partition), nơi **gọi ra ngoài** (external API có rate limit, latency bạn không kiểm soát), nơi **chạy đơn lẻ** (cron trong 1 process, publisher singleton). Nhìn vào sơ đồ SBOM: Postgres (gộp), ClearlyDefined/OSV (ngoài), gocron + RabbitMQ publisher trong 1 container (đơn lẻ) — đúng là 3 nơi sinh ra phần lớn sự cố thật.

#### Khung 45 phút trong phỏng vấn
1. **Làm rõ yêu cầu (5 phút)**: chốt functional 3–6 gạch đầu dòng, non-functional có số, ngoài phạm vi.
2. **Ước lượng (5 phút)**: QPS đọc/ghi, dung lượng, băng thông → biết mình đang thiết kế ở quy mô nào (bài F2).
3. **Thiết kế tổng thể (10–12 phút)**: sơ đồ, API chính, mô hình dữ liệu, luồng đọc/ghi.
4. **Đào sâu (15–18 phút)**: 2–4 điểm nóng, mỗi điểm 2–3 phương án và lý do chọn.
5. **Trade-off và điểm yếu (5 phút)**: tự nói ra cái mình hy sinh và sẽ làm gì khi scale 10×.

### Số liệu cần nhớ
#### Latency numbers every programmer should know (làm tròn)
| Thao tác | Thời gian | Ghi nhớ |
|---|---|---|
| L1 cache reference | ~1 ns | |
| Branch mispredict | ~5 ns | |
| L2 cache reference | ~7 ns | |
| Mutex lock/unlock | ~25 ns | Lock không đắt, contention mới đắt |
| Main memory reference | ~100 ns | RAM chậm hơn L1 ~100× |
| Compress 1 KB (Snappy) | ~3 µs | Nén rẻ hơn gửi qua mạng |
| Send 1 KB over 1 Gbps | ~10 µs | |
| SSD random read (4 KB) | ~100 µs | RAM nhanh hơn SSD ~1 000× |
| Read 1 MB sequentially from memory | ~250 µs | |
| Round trip trong cùng datacenter | ~500 µs | Mỗi call tới DB/Redis tốn tối thiểu chừng này |
| Read 1 MB sequentially from SSD | ~1 ms | |
| HDD seek | ~10 ms | Random I/O trên HDD là kẻ thù |
| Read 1 MB sequentially from network (1 Gbps) | ~10 ms | |
| Read 1 MB sequentially from HDD | ~30 ms | |
| Send packet CA → Netherlands → CA | ~150 ms | Liên lục địa = 300 lần RTT trong datacenter |

Rút ra: (1) chuỗi 10 call nối tiếp trong DC = 5 ms, 10 call liên lục địa = 1,5 s; (2) đọc từ RAM/cache rẻ hơn disk 3 bậc; (3) random I/O trên HDD chậm hơn sequential ~100× nên DB và Kafka đều ghi tuần tự (bài F4).

#### Powers of two
| Lũy thừa | Giá trị xấp xỉ | Đơn vị |
|---|---|---|
| 2^10 | 1 nghìn (1 024) | 1 KB |
| 2^20 | 1 triệu | 1 MB |
| 2^30 | 1 tỷ | 1 GB |
| 2^40 | 1 nghìn tỷ | 1 TB |
| 2^50 | 1 triệu tỷ | 1 PB |

#### Availability (downtime cho phép)
| Availability | Mỗi năm | Mỗi tháng | Mỗi ngày |
|---|---|---|---|
| 99% (2 nines) | 3,65 ngày | 7,3 giờ | 14,4 phút |
| 99,9% (3 nines) | 8,76 giờ | 43,8 phút | 1,44 phút |
| 99,99% (4 nines) | 52,6 phút | 4,38 phút | 8,6 giây |
| 99,999% (5 nines) | 5,26 phút | 26,3 giây | 0,86 giây |

99,99% nghĩa là một lần deploy hỏng 10 phút đã đốt hết budget 2 tháng. Mỗi "nine" thêm vào tốn gấp nhiều lần tiền và độ phức tạp; phần lớn SaaS B2B sống tốt ở 99,9%.

### Sai lầm hay gặp
- Nhảy vào vẽ sơ đồ trước khi hỏi yêu cầu; thiết kế cho 100 triệu user khi đề bài là 10 000 tenant.
- Dùng average latency thay vì percentile; không hỏi read/write ratio.
- "Dùng microservice/Kafka để scale" mà không chỉ ra bottleneck đang ở đâu.
- Không tự nêu điểm yếu của thiết kế → interviewer phải khui ra, và lúc đó bạn ở thế bị động.
- Thuộc số nhưng không dùng: vẽ 5 service gọi nối tiếp nhau rồi hứa p99 50 ms.
- Coi non-functional là "sau này tính": sự cố #6 (bảng 9,6 triệu dòng không index) chính là non-functional bị bỏ quên.

### Nói thế nào trong phỏng vấn (EN)
- "Before I draw anything, let me clarify the functional scope and the non-functional targets: latency, availability, consistency, and scale." — Trước khi vẽ, tôi muốn chốt phạm vi chức năng và mục tiêu phi chức năng.
- "What read/write ratio and what p99 latency are we targeting?" — Tỉ lệ đọc/ghi và p99 mục tiêu là bao nhiêu?
- "Every choice here is a trade-off; I'll call out what we give up each time." — Mọi lựa chọn đều là trade-off; tôi sẽ nói rõ mình hy sinh gì.
- "A round trip inside the datacenter is about half a millisecond, so ten sequential calls already cost us five milliseconds." — Một RTT trong DC ~0,5 ms, nên 10 call nối tiếp đã mất 5 ms.
- "The weakest point of this design is the single primary database; at 10x load that is where I would invest first." — Điểm yếu nhất là DB primary đơn; khi tải gấp 10, đó là nơi tôi đầu tư trước.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Viết 1 trang **non-functional requirements hiện trạng**: p95 của GET components / EOL / vulnerability audit (cam kết pilot đang là ≤ 5 s), availability mục tiêu, consistency chấp nhận cho license/vulnerability enrichment (eventual, bao lâu?), durability của audit log (không được mất — nhưng sự cố #12 đang làm mất). Chỗ nào không điền được số là chỗ chưa ai quyết định.
- Vẽ lại sơ đồ hiện trạng (FE → apiserver → Postgres/FDW, Redis, RabbitMQ → worker; Lambda → ClearlyDefined/OSV/NVD/GHSA/EUVD/JVNDB). Với mỗi mũi tên ghi: sync/async, timeout, hành vi khi đích chết. Mũi tên nào bạn không trả lời được là backlog kỹ thuật.
- Đánh dấu 3 loại điểm nóng: gộp traffic (Postgres tenant + FDW tới DB vulnerability), gọi ngoài (Lambda → ClearlyDefined, sự cố #7), chạy đơn lẻ (gocron và AMQP publisher trong một container, sự cố #1 và #9).
- Đo thật: từ OTel/log lấy p50/p95/p99 của 5 endpoint nặng nhất tuần này; đếm số round trip DB cho một request danh sách component (có N+1 không?). 20 query × 0,5 ms RTT = 10 ms chỉ cho mạng, chưa tính thực thi.
- Áp số vào upload: 1 SBOM 10 000 component, nếu insert từng dòng = 10 000 RTT ≈ 5 s thuần network → lý do bắt buộc batch insert/COPY.
- Viết ADR 1 trang "Mục tiêu non-functional cho release tới" và đề xuất với PO: SLO nào, đo bằng gì, ai nhận alert.
`,
  quiz: [
    { t: 'mc', q: 'Yêu cầu nào sau đây là non-functional requirement?', o: ['Người dùng upload được file SBOM định dạng CycloneDX', 'Hệ thống gửi notification khi phát hiện vulnerability mới', 'p99 latency của API danh sách component dưới 500 ms', 'Admin xoá được project của tenant'], a: 2, why: 'Non-functional mô tả hệ thống làm việc đó tốt đến đâu (latency, availability...), các lựa chọn còn lại là chức năng.' },
    { t: 'mc', q: 'Round trip giữa hai máy trong cùng datacenter xấp xỉ bao nhiêu?', o: ['~5 µs', '~500 µs', '~5 ms', '~50 ms'], a: 1, why: 'Khoảng 0,5 ms; đây là chi phí tối thiểu cho mỗi call tới DB hay Redis.' },
    { t: 'mc', q: 'Hệ thống cam kết 99,99% availability. Downtime tối đa cho phép mỗi năm là bao nhiêu?', o: ['~52 phút', '~8,7 giờ', '~5 phút', '~3,6 ngày'], a: 0, why: '0,01% của 365 ngày ≈ 52,6 phút; 99,9% mới là 8,76 giờ.' },
    { t: 'mc', q: 'Đọc 1 MB tuần tự: RAM ~250 µs, SSD ~1 ms, HDD ~30 ms. Phát biểu nào đúng?', o: ['SSD đọc tuần tự nhanh hơn RAM', 'HDD chậm hơn SSD khoảng 30 lần khi đọc tuần tự 1 MB', 'RAM chậm hơn gửi 1 MB qua mạng 1 Gbps', 'HDD seek ~10 ms nhanh hơn round trip trong datacenter'], a: 1, why: '30 ms so với 1 ms là 30 lần; RTT trong DC chỉ 0,5 ms nên nhanh hơn HDD seek 20 lần.' },
    { t: 'mc', q: 'Interviewer nói "Design a system like X". Việc đầu tiên nên làm là gì?', o: ['Vẽ ngay sơ đồ với load balancer, cache và DB', 'Chọn ngôn ngữ và framework', 'Ước lượng QPS trước để biết quy mô', 'Hỏi để chốt functional, non-functional và quy mô'], a: 3, why: 'Không có yêu cầu đo được thì ước lượng lẫn sơ đồ đều là đoán; ước lượng đến ngay sau khi chốt yêu cầu.' },
    { t: 'fill', q: 'Điền: 2^30 byte xấp xỉ bằng 1 ___.', a: ['gb', 'gigabyte', '1 gb', 'gib', 'gibibyte'], why: '2^10 KB, 2^20 MB, 2^30 GB, 2^40 TB.' },
    { t: 'fill', q: 'Điền: thay vì trung bình, mục tiêu latency nên đặt theo ___ (ví dụ p95, p99) để không bị che mất đuôi chậm.', a: ['percentile', 'phân vị', 'p99', 'p95', 'tail latency'], why: 'Average che giấu tail latency; SLO luôn viết theo percentile.' },
    { t: 'open', q: 'Explain the difference between functional and non-functional requirements, and why you clarify them before drawing any architecture.', a: 'Functional requirements describe what the system does (upload an SBOM, list components). Non-functional requirements describe how well it must do it: latency percentiles, availability, consistency, durability, scale and cost. I clarify them first because they drive the architecture: a 99.99% target forces redundancy, a strict read-your-writes requirement rules out naive read replicas, and a 60k read QPS estimate makes caching mandatory. Every design decision is a trade-off, and without measurable targets I cannot justify which side of the trade-off to take.', keys: ['functional', 'non-functional', 'latency', 'availability', 'trade-off'] }
  ]
},
{ id: 'F2', type: 'foundation', topic: 'design', title: 'Ước lượng back-of-envelope: QPS, dung lượng, băng thông, cache', time: '90 phút',
  goal: 'Trong 5 phút tính được QPS trung bình/đỉnh, dung lượng 1–5 năm, băng thông và kích thước cache cho một đề bài bất kỳ, với giả định nói rõ và số làm tròn đúng bậc.',
  md: `
### Vấn đề cần giải
Thiết kế không có số là đoán mò. 100 QPS và 100 000 QPS là hai thế giới: một bên là một Postgres và một API server, bên kia là cache bắt buộc, queue, sharding. Back-of-envelope estimation (ước lượng trên mặt sau phong bì) trả lời 3 câu: hệ thống này **to cỡ nào**, bottleneck **nằm ở đâu** (request? dòng dữ liệu? băng thông?), và kiến trúc nào là **vừa đủ**. Trong phỏng vấn, 5 phút ước lượng chứng tỏ bạn hiểu quy mô; trong công việc, nó cho bạn biết sweeper 100 dòng/phút không bao giờ đuổi kịp backlog 696 000 dòng (sự cố #16) trước khi viết dòng code nào.

### Cốt lõi
#### Công thức
- 1 ngày = 86 400 s ≈ **10^5 s** (làm tròn cho dễ chia). 1 tháng ≈ 2,6 × 10^6 s; 1 năm ≈ 3,15 × 10^7 s.
- **QPS trung bình** = DAU × số hành động/người/ngày ÷ 86 400.
- **Peak QPS** = 2–3 × trung bình (traffic dồn vào 8–10 giờ làm việc; sự kiện đặc biệt có thể 10×). Thiết kế theo peak, tính tiền theo trung bình.
- **Storage** = bản ghi/ngày × kích thước bản ghi × 365 × số năm. Cộng thêm index (~20–50%) và replication (×3 nếu tính đĩa thô).
- **Bandwidth** = QPS × payload trung bình; tách inbound/outbound vì thường lệch nhau 10–100×.
- **Cache** theo quy tắc 80/20: 20% dữ liệu được đọc tạo ra 80% traffic → cache ≈ 20% × dữ liệu đọc trong ngày.
- **Little's law**: số request đang bay (concurrency) = throughput × latency. 1 000 RPS × 0,2 s = 200 request đồng thời → cần ≥ 200 goroutine/connection; latency tăng gấp 5 thì concurrency tăng gấp 5 — đó là cách pool cạn.

#### Kích thước tham khảo
| Thứ | Kích thước | Ghi chú |
|---|---|---|
| Ký tự ASCII / UTF-8 tiếng Việt | 1 B / 2–3 B | |
| int64, timestamp | 8 B | |
| UUID dạng chuỗi / binary | 36 B / 16 B | Lưu binary tiết kiệm nhưng khó đọc log |
| URL trung bình | ~100 B | |
| Một tweet có metadata | ~300 B | |
| Một dòng component SBOM trong DB | ~0,5–1 KB | purl, version, license, hash, FK |
| Ảnh thumbnail / ảnh gốc | ~20 KB / ~1 MB | Media luôn đi object storage |
| 1 Gbps / 10 Gbps | 125 MB/s / 1,25 GB/s | Nhớ chia 8: Mbps → MB/s |

#### Năng lực một máy (rule of thumb để biết cần mấy máy)
| Thành phần | Năng lực xấp xỉ | Khi nào vượt |
|---|---|---|
| Web server Go stateless | vài nghìn đến vài chục nghìn RPS cho request nhẹ | Request gọi DB/API ngoài thì giảm 10× |
| Postgres 1 node | vài nghìn TPS ghi đơn giản; vài chục nghìn QPS đọc theo PK trong cache | Ghi hàng chục nghìn/s cần batch/COPY hoặc shard |
| Redis 1 instance | ~100 000 ops/s | Hot key, big key làm tụt mạnh |
| Kafka | 1 partition hàng chục MB/s; 1 broker vài trăm MB/s | Thêm partition để song song consumer |
| SSD NVMe / HDD | hàng trăm nghìn IOPS / ~100–200 IOPS | HDD không chịu được random I/O |
| Connection Postgres | ~5–10 MB RAM mỗi backend | Vài trăm connection đã là nhiều (bài F5) |

#### Ví dụ 1: Twitter-like, 300 triệu DAU
Giả định (nói to): 300M DAU; mỗi người đăng 2 tweet/ngày, đọc timeline 20 lần/ngày, mỗi lần 20 tweet; 10% tweet có ảnh 1 MB; lưu 5 năm.
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Write QPS | 300M × 2 ÷ 10^5 | 6 000 (peak ~15 000) |
| Read QPS (timeline) | 300M × 20 ÷ 10^5 | 60 000 (peak ~150 000) |
| Read/write ratio | 60 000 ÷ 6 000 | 10:1 → read-heavy → cache timeline, fan-out on write |
| Storage text | 600M × 300 B | 180 GB/ngày ≈ 65 TB/năm ≈ 330 TB/5 năm |
| Storage media | 600M × 10% × 1 MB | 60 TB/ngày ≈ 22 PB/năm → object storage + CDN |
| Bandwidth đọc text | 60 000 × 20 × 300 B | ~360 MB/s → không một máy nào tải nổi, phải nhiều node + CDN |
| Cache 20% tweet/ngày | 120M × 300 B | ~36 GB → vài node Redis |
Kết luận 1 câu: read-heavy 60k QPS, storage bị media chi phối, text thì Postgres chịu được nếu partition.

#### Ví dụ 2: Hệ thống upload file (kiểu SBOM)
Giả định: 10 000 tenant × 50 upload/ngày = 500 000 file/ngày; file trung bình 5 MB chứa 2 000 component; mỗi component ~500 B trong DB.
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| QPS upload | 500 000 ÷ 10^5 | 5 (peak 15) → HTTP không phải vấn đề |
| Inbound bandwidth | 5 × 5 MB (peak 15 × 5 MB) | 25 MB/s ≈ 200 Mbps; peak 600 Mbps sát NIC 1 Gbps → upload thẳng S3 bằng presigned URL |
| File storage | 500 000 × 5 MB | 2,5 TB/ngày ≈ 900 TB/năm → S3 + lifecycle |
| Dòng component | 500 000 × 2 000 | 1 tỷ dòng/ngày ≈ 12 000 insert/s trung bình, 36 000 đỉnh |
| DB storage | 1 tỷ × 500 B | 500 GB/ngày → Postgres đơn không nuốt nổi |
Kết luận: "file nhỏ, dòng nhiều" — bottleneck là insert vào DB, không phải upload. Hệ quả thiết kế: batch insert/COPY, dedupe component theo hash (cùng một log4j xuất hiện ở 10 000 tenant), partition theo tenant/thời gian, giữ raw file ở S3 và chỉ lưu dữ liệu đã chuẩn hoá.

#### Ví dụ 3: Hệ thống log tập trung
Giả định: 1 000 server × 100 dòng/s × 200 B/dòng, giữ 30 ngày.
| Đại lượng | Phép tính | Kết quả |
|---|---|---|
| Throughput | 100 000 dòng/s × 200 B | 20 MB/s (peak 60 MB/s) |
| Storage raw | 20 MB/s × 86 400 × 30 | ~1,7 TB/ngày → 52 TB/30 ngày |
| Sau nén 5–10× | 52 ÷ 5…10 | 5–10 TB; index full-text thêm 50–100% raw |
| Kafka partition | 60 MB/s ÷ ~20 MB/s | tối thiểu 3, lấy 6–12 để có headroom và song song consumer |

#### Cách trình bày trong phỏng vấn
- Nói to giả định rồi hỏi interviewer có đồng ý không: "Let's assume 300 million DAU and 2 posts per user per day".
- Làm tròn mạnh: 86 400 → 10^5; 300M × 2 → 6 × 10^8. Chỉ cần đúng **bậc** (order of magnitude), sai 2× không ai trừ điểm, sai 100× thì có.
- Viết công thức trước, điền số sau, ghi đơn vị. Kết thúc mỗi phép tính bằng một câu ý nghĩa: "so this is read-heavy and cache is mandatory".
- Quay lại các con số khi chọn thiết kế; ước lượng rồi bỏ đó là lãng phí 5 phút.

### Số liệu cần nhớ
| Quy đổi | Giá trị |
|---|---|
| 1 ngày | 86 400 s ≈ 10^5 s |
| 1 triệu hành động/ngày | ≈ 12 QPS |
| 100 triệu hành động/ngày | ≈ 1 200 QPS |
| 1 tỷ hành động/ngày | ≈ 12 000 QPS |
| 1 QPS × 1 KB | ≈ 86 MB/ngày ≈ 31 GB/năm |
| 1 TB | 10^12 B ≈ 2^40 B |
| Peak | 2–3 × trung bình |

### Sai lầm hay gặp
- Tính chính xác tới hàng đơn vị, mất 5 phút cho một phép nhân; interviewer chỉ cần bậc.
- Quên peak, quên index và replication overhead → thiếu năng lực 3–5 lần.
- Trộn bit và byte (300 Mbps không phải 300 MB/s).
- Chỉ tính QPS mà bỏ qua storage/bandwidth → không nhận ra media hoặc "dòng dữ liệu" mới là bài toán.
- Giả định ngầm, không nói ra → interviewer không biết bạn tính cho quy mô nào.
- Ước lượng xong không dùng lại khi chọn cache/DB/queue.

### Nói thế nào trong phỏng vấn (EN)
- "Let me do a quick back-of-the-envelope estimate to see what scale we are designing for." — Để tôi ước lượng nhanh xem ta thiết kế ở quy mô nào.
- "Assuming 300 million daily active users posting twice a day, that is roughly six thousand writes per second, say fifteen thousand at peak." — Giả sử 300 triệu DAU đăng 2 lần/ngày, khoảng 6 000 ghi/giây, đỉnh 15 000.
- "I'll round a day to ten to the fifth seconds; we only care about the order of magnitude here." — Tôi làm tròn 1 ngày thành 10^5 giây; ở đây chỉ cần đúng bậc.
- "So storage is dominated by media, not text — that pushes us toward object storage plus a CDN." — Dung lượng bị media chi phối, nên ta cần object storage + CDN.
- "With a 10:1 read/write ratio and sixty thousand reads per second, caching is not optional." — Với tỉ lệ 10:1 và 60 000 đọc/giây, cache là bắt buộc.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Lập **capacity sheet** cho hệ thống thật, mỗi release cập nhật: số tenant active, upload/ngày (đếm t_project_revisions theo created_at 30 ngày), component/upload trung bình và p95, số link component–vulnerability, kích thước DB tenant và DB vulnerability.
- Áp số vào sự cố #16: 5 file stress test × 200 000 component = 1 triệu dòng pending; sweeper xử lý 100 dòng/lượt mỗi phút → 696 000 ÷ 100 ≈ 7 000 phút ≈ 5 ngày *nếu* mỗi lượt thành công. Chỉ phép chia này đã cho thấy sweeper phải xử lý theo lô nghìn dòng và cần partial index.
- Sự cố #3 kiểm chứng bằng số: 490 000 dòng vulnerability × ~1 KB (struct Go + GORM overhead) × 10 goroutine ≈ 5 GB — khớp đúng OOM 5 GiB quan sát được. Trước khi mở thêm goroutine, nhân thử.
- Sự cố #11: export 2 triệu dòng × 1 KB = 2 GB nếu ReadAll vào RAM → phải stream theo trang.
- Enrichment: số component mới/ngày ÷ batch 100 = số call ClearlyDefined/ngày; so với rate limit của họ và với thời lượng Lambda 900 s. Policy: 238 policy × số project × tần suất eval → query/s vào Postgres (sự cố #6) — con số này nên nằm trong ADR trước khi bật thêm policy.
- Từ Little's law: lấy RPS × p95 latency của apiserver hiện tại → số request đang bay → so với SetMaxOpenConns của pool và max_connections Aurora.
- Việc tuần này: viết file capacity.md trong repo với 10 con số trên và nguồn query lấy ra; mang vào buổi planning.
`,
  quiz: [
    { t: 'mc', q: 'DAU 50 triệu, mỗi người tạo 4 request/ngày. QPS trung bình xấp xỉ?', o: ['~200', '~2 000', '~20 000', '~200 000'], a: 1, why: '50M × 4 = 2 × 10^8 chia 10^5 s ≈ 2 000 QPS.' },
    { t: 'mc', q: 'Vì sao ước lượng lấy peak bằng 2–3 lần trung bình?', o: ['Vì traffic dồn vào vài giờ trong ngày thay vì trải đều 24 giờ', 'Vì server luôn chạy ở ~30% CPU', 'Vì replication factor thường là 3', 'Vì TCP overhead khoảng 2×'], a: 0, why: 'Trung bình chia cho 86 400 s nhưng người dùng tập trung trong 8–10 giờ, nên đỉnh cao hơn 2–3 lần.' },
    { t: 'mc', q: '1 tỷ bản ghi/ngày, mỗi bản ghi 500 B. Dung lượng sau 1 năm (chưa tính index) xấp xỉ?', o: ['~1,8 TB', '~18 TB', '~180 TB', '~1,8 PB'], a: 2, why: '500 GB/ngày × 365 ≈ 180 TB.' },
    { t: 'mc', q: 'Luồng inbound 300 Mbps tương đương bao nhiêu MB/s?', o: ['~37 MB/s', '~300 MB/s', '~2 400 MB/s', '~3,7 MB/s'], a: 0, why: 'Chia 8: 300 Mbps ≈ 37,5 MB/s.' },
    { t: 'mc', q: 'Theo Little\'s law, dịch vụ nhận 2 000 RPS với latency trung bình 100 ms có bao nhiêu request đang xử lý đồng thời?', o: ['20', '2 000', '20 000', '200'], a: 3, why: 'L = λ × W = 2 000 × 0,1 s = 200.' },
    { t: 'fill', q: 'Điền: để ước lượng nhanh, 1 ngày được làm tròn thành ___ giây.', a: ['10^5', '100000', '100 000', '86400', '86 400', '10^5 s'], why: '86 400 s ≈ 10^5 s, chia cho dễ.' },
    { t: 'fill', q: 'Điền: quy tắc ___ nói rằng khoảng 20% dữ liệu sinh ra 80% lượng truy cập, dùng để ước lượng kích thước cache.', a: ['80/20', 'pareto', '80-20', '80 20', '80:20'], why: 'Nguyên lý Pareto: cache 20% dữ liệu nóng là đủ cho đa số request.' },
    { t: 'open', q: 'Estimate the load for a photo-sharing app: 10 million DAU, each uploads 2 photos per day (2 MB each) and views 50 photos per day. State QPS, storage per year and bandwidth.', a: 'Uploads: 10M × 2 = 20M per day ≈ 200 writes per second, peak around 600. Views: 10M × 50 = 500M per day ≈ 5 000 reads per second, peak 15 000, so read-heavy at 25:1. Storage: 20M × 2 MB = 40 TB per day, roughly 15 PB per year, which must go to object storage with a CDN in front. Inbound bandwidth: 200 × 2 MB = 400 MB/s average, over 1 GB/s at peak, so uploads should go directly to object storage via presigned URLs rather than through the API servers. Metadata is tiny by comparison (20M rows × ~300 B = 6 GB per day) and fits a relational DB.', keys: ['qps', 'peak', 'storage', 'bandwidth', 'object storage'] }
  ]
},
{ id: 'F3', type: 'foundation', topic: 'net', title: 'Mạng cho system design: DNS, TCP/UDP, HTTP/1.1–2–3, TLS, WebSocket/SSE/long polling, CDN', time: '120 phút',
  goal: 'Tính được số RTT của một request HTTPS từ lạnh, chọn đúng giữa polling/long polling/SSE/WebSocket theo bài toán, và kể trọn "what happens when you type a URL" trong 2 phút có số liệu.',
  md: `
### Vấn đề cần giải
Mọi hộp trong sơ đồ nói chuyện với nhau qua mạng, và mỗi mũi tên tốn ít nhất một round trip. Với request nhỏ (đa số API), **RTT chứ không phải băng thông** quyết định latency: 0,5 ms trong datacenter, 60–80 ms Việt Nam ↔ Nhật, 150 ms liên lục địa. Hiểu DNS, TCP/TLS, các phiên bản HTTP giúp bạn giảm số RTT, tái sử dụng connection, và chọn mô hình realtime phù hợp thay vì mặc định WebSocket. Nó cũng giải thích những lỗi "ngớ ngẩn" rất đắt: FE server-side gọi API bằng hostname public từ trong Docker → hairpin NAT → ECONNREFUSED, 500 toàn site (sự cố #10).

### Cốt lõi
#### DNS
- Phân giải: browser cache → OS cache → recursive resolver (ISP, 8.8.8.8) → root → TLD (.com) → authoritative server → trả record A/AAAA (IP), CNAME (alias), kèm **TTL**.
- TTL cao (1 giờ+) = ít query, failover chậm; TTL thấp (60 s) = failover nhanh nhưng nhiều query và một số resolver/ứng dụng vẫn cache lâu hơn TTL. Trước khi đổi IP: hạ TTL trước 24 giờ.
- **DNS load balancing**: trả nhiều A record (round-robin) hoặc GeoDNS theo vị trí. Hạn chế: DNS không biết server chết (trừ khi có health check kiểu Route 53), client cache IP cũ, phân bố lệch. Dùng để chia theo region; trong region dùng load balancer thật.
- Service discovery nội bộ cũng là DNS: docker-compose/k8s resolve tên service → IP container. Trong mạng nội bộ phải gọi **tên nội bộ**, không gọi hostname public (sự cố #10).

#### TCP vs UDP
| | TCP | UDP |
|---|---|---|
| Kết nối | Có handshake, có trạng thái | Không |
| Đảm bảo | Thứ tự, không mất, kiểm soát tắc nghẽn | Không gì cả, gói độc lập |
| Chi phí | 1 RTT thiết lập, head-of-line blocking | Gần như 0 |
| Dùng cho | HTTP/1.1, HTTP/2, DB, gRPC | DNS, video/voice realtime, game, **QUIC (HTTP/3)** |

#### Chi phí handshake
| Bước | RTT | Ghi chú |
|---|---|---|
| TCP 3-way handshake | 1 | SYN → SYN-ACK → ACK (+ data) |
| TLS 1.2 | 2 | ClientHello, ServerHello/cert, key exchange, Finished |
| TLS 1.3 | 1 | Gộp key exchange vào hello |
| TLS 1.3 0-RTT (resumption) | 0 | Gửi data ngay; có nguy cơ replay → chỉ cho request idempotent |
| QUIC (HTTP/3) | 1 (0 khi resume) | Transport + TLS 1.3 trong cùng handshake |
Ví dụ: client Tokyo → server Singapore, RTT ~70 ms. HTTPS lạnh với TLS 1.2 = TCP 1 + TLS 2 + request 1 = 4 RTT = **280 ms** trước byte đầu tiên; TLS 1.3 = 3 RTT = 210 ms; connection sẵn (keep-alive) = 1 RTT = 70 ms. Bài học: giữ connection, đặt server gần user, giảm số hop **nối tiếp**.

#### Keep-alive và connection pooling
- HTTP/1.1 mặc định keep-alive; server đóng sau idle timeout (nginx 75 s, ALB 60 s). Idle timeout của **client pool phải nhỏ hơn** của server, nếu không client dùng connection vừa bị server đóng → "connection reset by peer" lác đác.
- Go: [[http.DefaultTransport]] có [[MaxIdleConnsPerHost = 2]]. Gọi một host bằng 100 goroutine → 98 connection bị đóng/mở lại liên tục: thêm handshake, TIME_WAIT đầy, cạn ephemeral port. Đặt [[MaxIdleConnsPerHost]] ≈ mức song song, [[IdleConnTimeout]] < server, và **luôn đọc hết rồi đóng [[resp.Body]]** để connection được trả về pool.
- DB connection tương tự: tạo mỗi request là tốn 1 RTT + auth + process backend (bài F5).

#### HTTP/1.1 → HTTP/2 → HTTP/3
| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC trên UDP |
| Song song | 1 request/connection tại một thời điểm; browser mở ~6 connection/origin | Multiplexing nhiều stream trên 1 connection, HPACK nén header | Stream độc lập trên QUIC |
| Head-of-line blocking | Ở tầng HTTP (request sau chờ request trước) | Chuyển xuống TCP: mất 1 packet → mọi stream chờ | Không giữa các stream |
| Khác | Text, đơn giản, cache proxy hiểu | Binary, priority, server push (đã bỏ) | Connection migration (đổi WiFi → 4G không rớt), congestion control ở user space |
- gRPC chạy trên HTTP/2 với connection sống lâu: load balancer L4 chỉ cân bằng **connection**, không cân bằng **request** → một instance ôm hết stream. Cần L7 LB hiểu HTTP/2 hoặc client-side balancing.

#### Realtime: polling, long polling, SSE, WebSocket
| Cơ chế | Cách hoạt động | Latency | Chi phí | Dùng khi |
|---|---|---|---|---|
| Polling | Client hỏi mỗi N giây | ≤ N | Nhiều request rỗng; đơn giản nhất; cache/CDN được | Tần suất thấp, job status mỗi 5–10 s |
| Long polling | Server giữ request tới khi có dữ liệu hoặc timeout ~30 s, client gọi lại ngay | Thấp | Mỗi client giữ 1 connection; ổn với Go/event loop, nặng với thread-per-request | Cần qua proxy/firewall cũ, fallback cho WebSocket |
| SSE (Server-Sent Events) | Response text/event-stream một chiều, giữ mở; tự reconnect với Last-Event-ID | Thấp | HTTP thường, chạy tốt trên HTTP/2; chỉ text, một chiều | Notification, feed, progress bar, log stream |
| WebSocket | Upgrade từ HTTP → full-duplex TCP | Thấp nhất | Tự lo ping/pong, reconnect, auth, scale (pub/sub để node nào cũng gửi được) | Chat, game, collaborative editing, tần suất hai chiều cao |
Rule: chỉ server → client thì **SSE**; hai chiều tần suất cao thì **WebSocket**; tần suất thấp thì **polling** là đủ và dễ vận hành nhất. Chọn WebSocket "cho chắc" là trả tiền vận hành cho tính năng không dùng.

#### CDN cơ bản
- Edge cache gần user; **pull** (origin fetch khi miss) phổ biến hơn **push**. Cache key = URL (+ header chọn lọc, không phải toàn bộ cookie). Điều khiển bằng [[Cache-Control: max-age / s-maxage]], [[ETag]] + 304, purge/invalidation theo path hoặc tag. Metric chính: cache hit ratio; origin shield giảm tải origin khi nhiều edge cùng miss.
- Dùng cho static asset, ảnh/video, API GET public; không cache response cá nhân hoá (hoặc cache theo user rất ít hiệu quả). Hệ thống B2B ít user như SBOM: CDN chủ yếu cho FE bundle và tải file export.

#### What happens when you type a URL (bản 2 phút)
1. Browser parse URL, kiểm tra HSTS và cache.
2. DNS resolve (cache → resolver → root/TLD/authoritative) → IP, thường là IP của CDN/LB (anycast).
3. TCP 3-way handshake (1 RTT) → TLS 1.3 handshake (1 RTT): SNI, certificate chain, key exchange. Hoặc QUIC gộp còn 1 RTT.
4. HTTP request [[GET /]] với Host, Cookie, Accept-Encoding.
5. Edge/LB: terminate TLS, route theo host/path, health check, forward đến app server.
6. App: auth, query cache/DB, trả JSON/HTML nén gzip/brotli kèm Cache-Control.
7. Browser parse HTML → tải asset song song (HTTP/2 multiplex), CDN phục vụ static; JS gọi API tiếp.
8. Connection giữ keep-alive để request sau chỉ tốn 1 RTT.

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| RTT cùng datacenter / khác AZ cùng region | ~0,5 ms / 1–2 ms |
| RTT Việt Nam ↔ Nhật / Tokyo ↔ Singapore | ~60–80 ms / ~70 ms |
| RTT liên lục địa | ~150 ms |
| HTTPS lạnh trước request: TLS 1.2 / TLS 1.3 / QUIC | 3 / 2 / 1 RTT |
| 1 Gbps | 125 MB/s; MTU 1 500 B |
| Browser HTTP/1.1 | ~6 connection/origin |
| Go [[DefaultTransport.MaxIdleConnsPerHost]] | 2 |
| Idle timeout nginx / ALB | 75 s / 60 s |

### Sai lầm hay gặp
- Tạo [[http.Client]] hoặc connection mới mỗi request → handshake liên tục, TIME_WAIT đầy, ephemeral port cạn.
- Không đóng [[resp.Body]] → leak file descriptor và connection không về pool.
- Chọn WebSocket cho mọi thứ realtime trong khi SSE/polling đủ và scale dễ hơn.
- Đặt DNS TTL 1 ngày rồi lúc sự cố không failover được.
- Đổ lỗi băng thông khi thực ra là N+1 call nối tiếp sang service khác (mỗi call 1 RTT).
- Gọi hostname public từ trong Docker network; bake env [[localhost]] vào image (sự cố #10).
- L4 LB trước gRPC → tải dồn vào một instance.

### Nói thế nào trong phỏng vấn (EN)
- "A cold HTTPS request costs two round trips before we even send the request with TLS 1.3, three with TLS 1.2, so connection reuse matters a lot across regions." — HTTPS lạnh tốn 2–3 RTT trước khi gửi request, nên tái sử dụng connection rất quan trọng.
- "Since the server only pushes notifications to the client, I'd use Server-Sent Events rather than WebSockets; it is plain HTTP and reconnects for free." — Chỉ server đẩy cho client nên tôi dùng SSE thay vì WebSocket.
- "HTTP/2 removes head-of-line blocking at the HTTP layer but not at the TCP layer; HTTP/3 over QUIC fixes that." — HTTP/2 bỏ HOL blocking ở tầng HTTP nhưng không ở TCP; HTTP/3 giải quyết.
- "I'd keep DNS TTL low on the failover record and rely on the load balancer, not DNS, for health-aware routing." — TTL thấp cho record failover, còn routing theo health thì dựa vào LB.
- "Most of our latency is sequential round trips, not bandwidth, so I would batch those calls." — Phần lớn latency là các RTT nối tiếp, nên tôi sẽ gộp các call đó.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Audit mọi [[http.Client]] gọi ClearlyDefined/OSV/NVD/GHSA/EUVD/JVNDB trong apiserver, worker và Lambda: có [[Timeout]] không, có đặt [[MaxIdleConnsPerHost]] không, có đọc hết và đóng Body ở mọi nhánh lỗi không. Chạy [[ss -s]] trên host canary để đếm TIME_WAIT khi enrichment đang chạy.
- Lambda ở region nào so với ClearlyDefined/OSV? Nếu RTT ~150 ms và gọi tuần tự 1 000 lần = 150 s chỉ cho mạng → batch 100 coordinate/call và song song có giới hạn (semaphore 5–10) là bắt buộc, không phải tối ưu.
- Sự cố #10: FE server-side gọi API qua hostname public → hairpin NAT. Sửa dứt điểm: FE dùng tên service nội bộ (ví dụ sbom:20000) qua **env runtime**, không bake vào image; viết checklist deploy "địa chỉ nội bộ vs công khai".
- Notification "scan hoàn tất / violation mới" trên dashboard hiện dùng gì? Nếu polling mỗi vài giây từ nhiều tab, cân nhắc SSE: một endpoint [[GET /events]] stream, FE tự reconnect; không cần WebSocket.
- Kiểm tra TTL DNS của domain pilot/canary và kế hoạch failover IP; kiểm tra idle timeout của Nginx Proxy Manager so với [[IdleConnTimeout]] của Go client gọi nội bộ.
- Đưa FE bundle và file export lớn ra CDN/S3 presigned URL thay vì stream qua apiserver.
`,
  quiz: [
    { t: 'mc', q: 'Một request HTTPS từ lạnh dùng TLS 1.3 (không 0-RTT). Trước khi gửi được request HTTP đầu tiên cần bao nhiêu RTT?', o: ['1', '2', '3', '4'], a: 1, why: 'TCP handshake 1 RTT + TLS 1.3 1 RTT = 2 RTT; TLS 1.2 mất 3.' },
    { t: 'mc', q: 'Server chỉ cần đẩy thông báo một chiều tới browser, tự reconnect, đi qua HTTP thường. Nên chọn?', o: ['WebSocket', 'Long polling', 'SSE', 'gRPC bidirectional streaming'], a: 2, why: 'SSE là HTTP thường, một chiều, có reconnect sẵn với Last-Event-ID; WebSocket là thừa.' },
    { t: 'mc', q: 'HTTP/2 vẫn bị head-of-line blocking ở đâu?', o: ['Tầng HTTP vì mỗi connection chỉ phục vụ 1 request', 'Tầng TCP: mất một packet thì mọi stream trên connection phải chờ', 'Tầng DNS khi TTL hết hạn', 'Tầng TLS khi renegotiate'], a: 1, why: 'HTTP/2 multiplex trên một TCP connection nên mất gói làm toàn bộ stream dừng; HTTP/3 dùng QUIC để tránh.' },
    { t: 'mc', q: 'Go client gọi cùng một host bằng 200 goroutine đồng thời với http.DefaultTransport. Hiện tượng gì xảy ra?', o: ['Connection mở/đóng liên tục vì MaxIdleConnsPerHost mặc định chỉ 2, TIME_WAIT tăng', 'Request bị serialize, mỗi lúc chỉ 1 request đi', 'Deadlock trong Transport', 'Không có vấn đề vì HTTP/2 multiplex'], a: 0, why: 'Chỉ 2 connection idle được giữ, 198 connection còn lại bị đóng sau mỗi request và phải handshake lại.' },
    { t: 'mc', q: 'Nhược điểm chính của load balancing bằng DNS round-robin là gì?', o: ['Không hỗ trợ IPv6', 'Chỉ dùng được với UDP', 'Tốn thêm 1 RTT mỗi request', 'Không biết server đã chết và client cache IP cũ theo TTL'], a: 3, why: 'DNS không có health check theo request và client giữ IP tới hết TTL (hoặc lâu hơn).' },
    { t: 'fill', q: 'Điền: HTTP/3 chạy trên giao thức transport ___ dựa trên UDP, gộp handshake với TLS 1.3.', a: ['quic'], why: 'QUIC loại bỏ HOL blocking giữa các stream và hỗ trợ connection migration.' },
    { t: 'fill', q: 'Điền: giữ TCP connection mở để dùng lại cho nhiều request HTTP gọi là ___.', a: ['keep-alive', 'keepalive', 'keep alive', 'persistent connection', 'connection reuse'], why: 'Tránh trả lại 2–3 RTT handshake cho mỗi request.' },
    { t: 'open', q: 'Walk me through what happens when a user types https://app.example.com in the browser and presses Enter.', a: 'The browser checks HSTS and its cache, then resolves the name through DNS: browser and OS cache, recursive resolver, root, TLD and authoritative servers, honoring TTL; the answer is usually a CDN or load balancer IP. It opens a TCP connection (one round trip) and negotiates TLS 1.3 (one more), or a single QUIC handshake. It sends the HTTP request; the load balancer terminates TLS, routes by host and path to a healthy application server, which authenticates, hits cache or the database, and returns a compressed response with cache headers. The browser parses HTML, fetches assets in parallel over HTTP/2 mostly from the CDN, runs JavaScript which calls the API, and keeps connections alive so later requests cost a single round trip.', keys: ['dns', 'tcp', 'tls', 'load balancer', 'cache'] }
  ]
},
{ id: 'F4', type: 'foundation', topic: 'os', title: 'Máy chủ và hệ điều hành: process/thread/goroutine, I/O, bộ nhớ, đĩa, container limits', time: '120 phút',
  goal: 'Giải thích được vì sao Go phục vụ hàng chục nghìn kết nối với vài thread, đọc được RSS/page cache/cgroup limit của một container, và chẩn đoán được OOM kill ngay cả khi docker inspect báo OOMKilled=false.',
  md: `
### Vấn đề cần giải
Mọi service cuối cùng chạy trên CPU, RAM, đĩa và socket của một máy, hoặc một cgroup trong máy đó. Không hiểu tầng này thì không hiểu vì sao worker chết im lặng, vì sao Postgres và Kafka đều ghi tuần tự, vì sao 10 000 connection không cần 10 000 thread. Sự cố #3 là ví dụ điển hình: worker ăn 5 GiB vì Preload toàn bộ vulnerability của project lớn (490 000 dòng) trong 10 goroutine song song; container không có memory limit nên kernel giết process ở cấp host, [[docker inspect]] vẫn báo [[OOMKilled=false]], và không ai biết vì sao container restart.

### Cốt lõi
#### Process, thread, goroutine
| Đơn vị | Bộ nhớ | Tạo / chuyển đổi | Ai lập lịch | Giới hạn thực tế |
|---|---|---|---|---|
| Process | Address space riêng, nhiều MB | fork đắt; context switch đắt nhất (đổi page table) | Kernel | Hàng trăm |
| Thread (OS) | Stack 1–8 MB ảo, chia sẻ heap | ~1–5 µs mỗi context switch + mất cache/TLB | Kernel | Vài nghìn đến vài chục nghìn |
| Goroutine | Stack bắt đầu vài KB, tự grow/shrink | ~0,2 µs mỗi lần chuyển | Go runtime (M:N) | Hàng trăm nghìn đến hàng triệu |
- Context switch = lưu/khôi phục register + mất nội dung cache. Nhiều thread hơn core thì CPU đi vào chuyển đổi chứ không vào việc.
- Go scheduler **M:N**: G (goroutine) chạy trên M (OS thread) qua P (processor logic, số lượng = [[GOMAXPROCS]]). Goroutine chờ I/O được **park**, M đi làm goroutine khác; chỉ cần số thread ≈ số core.

#### Blocking vs non-blocking I/O, epoll
- Blocking: thread gọi [[read()]] và ngủ cho tới khi có dữ liệu → mô hình thread-per-connection.
- Non-blocking + readiness notification: [[select/poll]] duyệt mọi fd O(n); [[epoll]] (Linux) / [[kqueue]] (BSD) báo sự kiện O(1) → một thread theo dõi 100 000 socket. [[io_uring]]: hàng đợi submit/complete chia sẻ với kernel, giảm syscall.
- **Go netpoller**: khi goroutine đọc socket chưa sẵn sàng, runtime đăng ký fd vào epoll và park goroutine; thread M làm việc khác; khi fd sẵn sàng, goroutine được đưa lại run queue. Bạn viết code blocking, runtime chạy non-blocking.
- Blocking syscall thật (file I/O trên đĩa, cgo, một số DNS) chiếm hẳn thread M → runtime tạo thêm thread. Hàng nghìn goroutine cùng đọc file = hàng nghìn thread; đó là lúc cần semaphore.

#### Ba mô hình server
| Mô hình | Ví dụ | Ưu | Nhược |
|---|---|---|---|
| Thread-per-request | Apache prefork, Java servlet cổ điển | Code đồng bộ, debug dễ | Tốn RAM/context switch; trần vài nghìn connection |
| Event loop | nginx, Node.js, Redis | 1 thread phục vụ hàng trăm nghìn connection | Một tác vụ CPU-bound chặn tất cả; callback/async khó đọc |
| M:N (goroutine, virtual thread) | Go, Erlang, Java 21 | Code đồng bộ, scale như event loop | GC, stack grow; "rẻ" không phải "vô hạn": 10 goroutine × 490 000 dòng vẫn là 5 GB (sự cố #3) |

#### File descriptor và ulimit
- Mỗi socket, file, pipe, epoll instance là một fd. Giới hạn mỗi process: [[ulimit -n]] (soft/hard), mặc định 1 024 trên nhiều distro; Docker thường kế thừa giới hạn lớn (1 048 576) nhưng systemd service thì không.
- Lỗi điển hình: "too many open files", [[accept: EMFILE]]. Nguyên nhân: leak (không [[Close()]] [[resp.Body]], [[rows]], file mở trong vòng lặp) hoặc đúng là cần nhiều (10 000 WebSocket).
- Kiểm tra: [[ls /proc/PID/fd | wc -l]], [[cat /proc/PID/limits]]. Phía client: ephemeral port (~28 000 mặc định) và TIME_WAIT cạn khi mở/đóng connection liên tục (bài F3).

#### Bộ nhớ
- VSZ (ảo) vs **RSS** (resident, thực sự chiếm RAM). Heap Go = live heap + headroom cho GC: với [[GOGC=100]] heap có thể gấp đôi live. RSS thường lớn hơn heap vì runtime, stack, fragmentation và bộ nhớ chưa trả OS.
- **Page cache**: kernel dùng RAM rảnh để cache file; [[free]] thấp không có nghĩa thiếu RAM. Kafka và Postgres sống nhờ page cache. Trong cgroup, page cache tính vào usage nhưng kernel reclaim nó trước khi OOM.
- Swap: container/k8s thường tắt swap → thiếu RAM là OOM ngay, không có giai đoạn "chậm dần".
- **cgroup memory limit** ([[docker --memory]], k8s [[limits.memory]]): vượt limit → OOM killer giết process lớn nhất **trong cgroup** → Docker báo [[OOMKilled=true]], exit code 137.
- **Không có limit**: process ăn tới hết RAM host → kernel OOM killer **toàn cục** giết process có oom_score cao nhất (có thể là bạn, có thể là container khác) → [[docker inspect]] vẫn [[OOMKilled=false]], chỉ thấy exit 137 (SIGKILL). Dấu vết nằm ở [[dmesg]] hoặc [[journalctl -k]] dòng "Out of memory: Killed process". Đó chính là sự cố #3; container không limit = không có bằng chứng.
- Go và limit: trước Go 1.19 runtime không biết cgroup limit; [[GOMEMLIMIT]] (soft limit) làm GC chạy gắt khi gần chạm → đặt ≈ 80–90% limit container. [[GOMAXPROCS]] trước Go 1.25 bằng số core **host** chứ không phải CPU quota → dùng [[automaxprocs]] hoặc Go 1.25+ (đã cgroup-aware: lấy theo CPU limit/quota của cgroup, không theo request, và cập nhật động).

#### Đĩa: sequential vs random, fsync, WAL
| Thiết bị | Random I/O | Latency | Sequential |
|---|---|---|---|
| HDD | ~100–200 IOPS | seek ~10 ms | 100–200 MB/s |
| SATA SSD | ~50–100k IOPS | ~100 µs | ~500 MB/s |
| NVMe SSD | 500k–1M IOPS | ~20–100 µs | vài GB/s |
| fsync | HDD ~10 ms; SSD 0,1–1 ms (phụ thuộc có tụ điện bảo vệ cache) | | |
- [[write()]] chỉ đưa dữ liệu vào page cache; **fsync** mới ép xuống đĩa bền. Không fsync thì mất điện là mất dữ liệu dù write đã trả về OK.
- **WAL (write-ahead log)**: ghi thay đổi vào log append-only **tuần tự** + 1 fsync, rồi áp dụng vào data file (random) sau theo lô ở checkpoint. Biến N random write đắt thành 1 sequential write rẻ và đảm bảo crash recovery. Group commit gom nhiều transaction vào một fsync.
- Postgres: WAL + shared_buffers + checkpoint; [[synchronous_commit]]; [[full_page_writes]]. Kafka: topic là log segment append-only, đọc/ghi tuần tự, dựa vào page cache và [[sendfile]] zero-copy → hàng trăm MB/s trên HDD thường. Cùng một nguyên lý: **biến random thành sequential**.

#### Container limits (CPU)
- [[cpu.max]] quota: container 0,5 CPU = 50 ms mỗi chu kỳ 100 ms; dùng hết thì bị **throttle** dù host rảnh → latency răng cưa. Xem [[cpu.stat nr_throttled]]. Go với GOMAXPROCS = 32 trên quota 1 CPU: GC và scheduler tranh nhau, throttle nặng.

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| Stack thread / goroutine | ~8 MB ảo / vài KB khởi đầu |
| Context switch thread / goroutine | 1–5 µs / ~0,2 µs |
| [[ulimit -n]] mặc định | 1 024 |
| Exit code 137 / 143 | SIGKILL (OOM, kill -9) / SIGTERM |
| fsync SSD / HDD | 0,1–1 ms / ~10 ms |
| HDD / NVMe random | 100–200 IOPS / 500k+ IOPS |
| GOGC=100 | Heap ≈ 2 × live heap |
| GOMEMLIMIT khuyến nghị | 80–90% memory limit của container |

### Sai lầm hay gặp
- Coi goroutine rẻ nên không giới hạn concurrency; không nhân thử bộ nhớ mỗi goroutine trước khi chạy song song (sự cố #3).
- Chạy container không memory limit, không GOMEMLIMIT, rồi kết luận "không phải OOM" vì [[OOMKilled=false]].
- Đọc [[free]] thấp tưởng thiếu RAM trong khi là page cache.
- Insert từng dòng rồi commit từng lần (mỗi commit một fsync) → vài trăm TPS; không dùng batch/COPY.
- Bỏ qua CPU throttling: host 20% CPU nhưng container bị throttle 40% thời gian.
- Không đóng rows/Body → leak fd → "too many open files" sau hai ngày chạy.

### Nói thế nào trong phỏng vấn (EN)
- "Go multiplexes goroutines onto a few OS threads; blocked network I/O is parked on epoll, so one connection per goroutine scales to tens of thousands of connections." — Go ghép goroutine lên vài thread, I/O chờ được park trên epoll nên một goroutine mỗi connection vẫn scale.
- "Cheap concurrency is not free memory: I bound parallelism with a semaphore and size it from per-task memory." — Concurrency rẻ không có nghĩa bộ nhớ miễn phí; tôi giới hạn song song bằng semaphore theo bộ nhớ mỗi tác vụ.
- "Exit code 137 with OOMKilled false usually means the host-level OOM killer, not the cgroup; I'd check dmesg and add a memory limit plus GOMEMLIMIT." — Exit 137 mà OOMKilled false thường là OOM killer cấp host; tôi xem dmesg và thêm limit + GOMEMLIMIT.
- "Databases write a sequential WAL first because one fsync on an append-only log is far cheaper than many random writes." — DB ghi WAL tuần tự trước vì một fsync trên log rẻ hơn nhiều random write.
- "Low free memory is mostly page cache; the kernel reclaims it before anything gets killed." — RAM free thấp chủ yếu là page cache, kernel reclaim trước khi giết gì.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Thêm [[mem_limit]] (hoặc [[deploy.resources.limits]]) cho worker và apiserver trong docker-compose; đặt [[GOMEMLIMIT]] = 80% limit; pin [[GOMAXPROCS]] theo CPU quota (automaxprocs hoặc Go 1.25). Không limit thì lần OOM tới vẫn vô hình như sự cố #3.
- Xác nhận các lần restart cũ: [[journalctl -k | grep -i "out of memory"]] trên host canary/pilot; đối chiếu timestamp với [[docker events]] và với giờ chạy reconcile policy. Ghi vào postmortem #3.
- Sửa gốc sự cố #3: thay Preload toàn bộ Vulnerabilities bằng truy vấn theo chunk 5 000 dòng và chỉ chọn cột cần; semaphore 3–4 cho goroutine policy eval thay vì 10; đo RSS trước/sau trên project test 90k component.
- Xuất [[go_memstats_heap_inuse_bytes]], [[process_resident_memory_bytes]], [[go_goroutines]] ra Prometheus; alert RSS > 70% limit và goroutine tăng đơn điệu (dấu hiệu leak).
- fd: [[cat /proc/PID/limits]] và đếm [[/proc/PID/fd]] của apiserver theo giờ; nếu tăng đều → tìm chỗ không đóng [[rows]] hoặc [[resp.Body]] trong các runner.
- Đĩa: Postgres trên EBS gp3 → fsync ~1 ms → một connection ghi tuần tự tối đa ~1 000 commit/s. Insert component theo batch/COPY trong một transaction thay vì từng dòng; đo lại thời gian import file 200k component.
- Kiểm tra [[cpu.stat]] của container worker trong giờ enrichment: nếu [[nr_throttled]] cao thì quota đang là bottleneck chứ không phải code.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao một process Go phục vụ được 100 000 connection với chỉ vài thread OS?', o: ['Vì Go không dùng syscall cho network', 'Vì goroutine stack nhỏ và netpoller dùng epoll để park goroutine đang chờ I/O', 'Vì Go tạo 100 000 thread rất nhanh', 'Vì mỗi connection dùng UDP nên không giữ trạng thái'], a: 1, why: 'Goroutine chờ socket được park, thread M tiếp tục chạy goroutine khác; chỉ cần số thread xấp xỉ số core.' },
    { t: 'mc', q: 'Container thoát với exit code 137, docker inspect báo OOMKilled=false, container không đặt memory limit. Khả năng cao nhất là gì?', o: ['Bị SIGTERM do deploy mới', 'Lỗi segfault trong cgo', 'Kernel OOM killer cấp host giết process; cần xem dmesg/journalctl -k', 'Ứng dụng tự gọi os.Exit(137)'], a: 2, why: 'Không có cgroup limit thì OOM xảy ra ở cấp host và Docker không gắn cờ OOMKilled; 137 = SIGKILL.' },
    { t: 'mc', q: 'Vì sao DB ghi WAL tuần tự trước rồi mới cập nhật data file?', o: ['Để biến nhiều random write thành sequential write với một fsync mà vẫn recovery được sau crash', 'Vì WAL nén tốt hơn data file', 'Vì data file chỉ được ghi khi shutdown', 'Để tiết kiệm RAM cho shared_buffers'], a: 0, why: 'Append-only log rẻ, một fsync đủ đảm bảo durability; data file được cập nhật sau theo lô ở checkpoint.' },
    { t: 'mc', q: 'Máy 16 GB không swap, app dùng 2 GB nhưng free báo chỉ còn 200 MB trống. Giải thích hợp lý nhất?', o: ['Memory leak của app', 'Docker chiếm 14 GB cho image layer', 'Kernel đếm sai bộ nhớ', 'Phần lớn là page cache, kernel sẽ reclaim khi cần'], a: 3, why: 'Kernel dùng RAM rảnh cache file; cột available/buff-cache mới phản ánh đúng.' },
    { t: 'mc', q: 'Container có CPU quota 1 core nhưng Go thấy GOMAXPROCS=32 theo host. Hậu quả?', o: ['Không ảnh hưởng gì', 'CPU throttling, latency răng cưa vì GC và scheduler dùng nhiều thread hơn quota', 'Chương trình crash khi khởi động', 'Goroutine không được tạo thêm'], a: 1, why: 'Runtime chạy 32 thread tranh 100 ms CPU mỗi chu kỳ, vượt quota là bị treo tới chu kỳ sau.' },
    { t: 'fill', q: 'Điền: cơ chế Linux thông báo fd sẵn sàng với độ phức tạp O(1), nền tảng của netpoller Go, là ___.', a: ['epoll'], why: 'epoll (kqueue trên BSD/macOS) thay cho select/poll O(n).' },
    { t: 'fill', q: 'Điền: biến môi trường Go 1.19+ đặt soft memory limit cho runtime để GC chạy gắt hơn khi gần chạm giới hạn: ___.', a: ['gomemlimit'], why: 'Đặt GOMEMLIMIT ≈ 80–90% memory limit của container.' },
    { t: 'open', q: 'Your worker container keeps restarting with exit code 137 but OOMKilled is false. How do you investigate and fix it?', a: 'Exit 137 is SIGKILL; with no cgroup limit the host OOM killer is the likely culprit, so I confirm with dmesg or journalctl -k for "Out of memory: Killed process" and correlate timestamps with the job that was running. Then I measure: RSS over time and the query that was executing, which in our case was a Preload of 490k rows times 10 goroutines. The fix has three layers: bound the work (paginate or stream the query in chunks, select only needed columns, limit concurrency with a semaphore sized from per-task memory), set a container memory limit with GOMEMLIMIT at about 80% of it so failures become visible and GC works harder, and add alerts on RSS and goroutine count so the next regression is caught before the kill.', keys: ['dmesg', 'memory limit', 'gomemlimit', 'concurrency', 'batch'] }
  ]
},
{ id: 'F5', type: 'foundation', topic: 'db', title: 'Cơ sở dữ liệu quan hệ cốt lõi: index, transaction, isolation, lock, pool, timeout', time: '150 phút',
  goal: 'Đọc được EXPLAIN ANALYZE để chọn đúng index (composite, partial, covering), nêu được anomaly của từng isolation level, và cấu hình pool/statement_timeout đúng tầng (session/role/transaction) cho service Go nối Postgres.',
  md: `
### Vấn đề cần giải
Postgres là nơi mọi traffic đổ về và là bottleneck số 1 của hầu hết hệ thống. Sự cố #6: bảng policy violation 9,6 triệu dòng chỉ có index PK, 238 policy được đánh giá liên tục → DB 4 vCPU ghim 100%, 55% request trả 500. Sự cố #4: [[statement_timeout]] 90 s đặt ở cấp role trên Aurora, code chỉ SET LOCAL trong transaction → query ngoài transaction vẫn bị giết. Index, transaction, lock, pool và timeout không phải kiến thức "DBA"; chúng là điều kiện tối thiểu để backend không tự bắn vào chân.

### Cốt lõi
#### B-tree index
- Cây cân bằng, lá chứa (key → vị trí dòng). Cao 3–4 tầng cho hàng trăm triệu dòng → tìm một key ≈ 3–4 page read, phần lớn trong cache. Hỗ trợ [[=]], [[<]], [[>]], [[BETWEEN]], [[ORDER BY]] theo key, [[LIKE 'abc%']] (không hỗ trợ [['%abc']]).
- **Composite index** (a, b, c) dùng được cho a; a,b; a,b,c (**leftmost prefix**); không dùng được cho riêng b hoặc c. Range trên a thì b không còn lọc trong index. Thứ tự cột: equality trước, range sau; nếu đều equality thì cột chọn lọc hơn trước.
- **Covering index / Index Only Scan**: mọi cột cần có nằm trong index ([[INCLUDE (col)]]) → không đọc heap. Cần visibility map sạch (VACUUM đều).
- **Partial index**: [[CREATE INDEX ... WHERE status = 'pending']] → index nhỏ, chỉ chứa dòng quan tâm, ghi rẻ. Sự cố #16: 696 000 dòng pending làm query sweeper chạy hàng phút; partial index [[idx_prcl_pending_rev]] đưa về mili giây.
- **Selectivity**: index chỉ đáng khi lọc ra tỉ lệ nhỏ (≲ 5–10% bảng); cột boolean 50/50 index gần như vô dụng trừ khi partial. Planner quyết định theo statistics ([[ANALYZE]]).
- Khi index **không** được dùng: hàm trên cột ([[lower(email)]] cần expression index), khác kiểu dữ liệu (text so với int, cast ngầm), [[LIKE '%x']], [[OR]] qua nhiều cột, [[NOT IN]], bảng nhỏ (seq scan rẻ hơn), statistics cũ, ORDER BY ngược chiều index không khai báo DESC.
- Mỗi index là chi phí ghi (mọi INSERT/UPDATE phải cập nhật mọi index) và RAM. Bảng ghi nhiều không nên có 10 index.

#### Đọc EXPLAIN ANALYZE
Chạy [[EXPLAIN (ANALYZE, BUFFERS) SELECT ...]], đọc từ node sâu nhất ra ngoài. Mỗi node có cost ước lượng, actual time, rows estimate so với actual, loops.
| Dấu hiệu | Ý nghĩa | Hành động |
|---|---|---|
| Seq Scan trên bảng lớn, Rows Removed by Filter lớn | Thiếu index hoặc index không dùng được | Tạo index đúng cột/điều kiện, sửa predicate |
| rows estimate lệch actual > 10× | Statistics cũ hoặc cột tương quan | ANALYZE, tăng statistics target, extended statistics |
| Nested Loop với outer nhiều dòng, inner không index | Join N lần quét | Index cột join hoặc để planner dùng Hash Join |
| Sort Method: external merge Disk | work_mem không đủ | Tăng work_mem cho session đó, hoặc index theo ORDER BY |
| Buffers: shared read lớn, hit nhỏ | Dữ liệu không trong cache | RAM/shared_buffers, hoặc sửa query đọc ít hơn |
| Index Scan nhưng loops hàng nghìn | N+1 từ ứng dụng | Gộp query, batch IN (...) |

#### ACID và isolation level
Atomicity (tất cả hoặc không), Consistency (ràng buộc luôn đúng), Isolation (transaction không thấy nhau dở dang), Durability (commit = bền nhờ WAL + fsync).
| Isolation level | Dirty read | Non-repeatable read | Phantom | Lost update / write skew | Postgres |
|---|---|---|---|---|---|
| Read Uncommitted | có (chuẩn SQL) | có | có | có | PG coi như Read Committed |
| Read Committed (mặc định) | không | **có** | **có** | **có** nếu read-modify-write không khoá | Mỗi statement thấy snapshot mới |
| Repeatable Read | không | không | không (PG chặn luôn) | write skew **có**; update đụng dòng đã đổi → lỗi 40001 | Snapshot isolation |
| Serializable | không | không | không | không | SSI, abort 40001 → app retry; overhead ~10–30% |
- Non-repeatable read: hai SELECT trong cùng tx thấy giá trị khác nhau. Phantom: cùng điều kiện, lần sau có thêm dòng. Lost update: hai tx đọc balance = 100 rồi cùng ghi 100 − 30 → mất một lần trừ; fix bằng [[UPDATE ... SET x = x - 30]] hoặc [[SELECT ... FOR UPDATE]].
- **Write skew**: hai bác sĩ trực cùng đọc "còn ≥ 2 người trực" rồi cùng xin nghỉ → 0 người trực. Repeatable Read không chặn vì hai tx ghi hai dòng khác nhau. Fix: Serializable, hoặc khoá dòng đại diện (ca trực) bằng FOR UPDATE, hoặc constraint/trigger.

#### MVCC, VACUUM, bloat
- Mỗi version dòng có xmin/xmax; UPDATE = chèn version mới + đánh dấu cũ chết; DELETE chỉ đánh dấu. Reader không chặn writer, writer không chặn reader.
- Dead tuple phải được **VACUUM** dọn; autovacuum theo ngưỡng (mặc định 20% bảng + 50 dòng). Bảng cập nhật trạng thái liên tục (pending → done) bloat rất nhanh, index bloat theo.
- **Transaction dài** (idle in transaction, report chạy 1 giờ) giữ xmin horizon → VACUUM không dọn được gì sau mốc đó → bloat toàn cục, query chậm dần. Để lâu không vacuum được → transaction ID wraparound, DB từ chối ghi.
- HOT update: không đổi cột có index và page còn chỗ ([[fillfactor]]) → không phải cập nhật index.

#### Lock
- Row lock: [[SELECT ... FOR UPDATE]] (chặn update/delete khác), [[FOR NO KEY UPDATE]] (nhẹ hơn, không chặn FK), [[FOR SHARE]]. [[SKIP LOCKED]] → pattern hàng đợi trong DB: nhiều worker lấy job không đụng nhau. [[NOWAIT]] → lỗi ngay thay vì chờ.
- **Deadlock**: tx A khoá r1 rồi xin r2, tx B ngược lại → PG phát hiện sau [[deadlock_timeout]] (1 s) và giết một tx. Phòng: khoá theo thứ tự cố định ([[ORDER BY id]]), transaction ngắn, không cập nhật nhiều dòng theo thứ tự ngẫu nhiên.
- **DDL lock**: [[ALTER TABLE]] lấy ACCESS EXCLUSIVE, xếp hàng sau một SELECT dài và chặn mọi query đến sau nó. Migration luôn [[SET lock_timeout = '5s']] và retry; [[CREATE INDEX CONCURRENTLY]]; thêm NOT NULL/FK theo 2 bước (NOT VALID rồi VALIDATE).
- **Advisory lock**: [[pg_try_advisory_lock(key)]] → mutex cấp ứng dụng không gắn với dòng; dùng cho leader election rẻ cho cron, chống chạy trùng job (liên quan sự cố #9). Session-level lock mất khi connection đóng, và không dùng được qua PgBouncer transaction pooling.

#### Connection pool
- Mỗi connection Postgres là một process backend ~5–10 MB (đo chuẩn bằng PSS ≈ 7–8 MiB, chỉ ~1–2 MiB khi huge_pages=on; RSS 16 MiB trong ps là ảo vì tính cả shared memory — Andres Freund 2020) + context switch; [[max_connections]] cao không đồng nghĩa throughput cao. Công thức khởi điểm (PG wiki, HikariCP): **pool ≈ cores × 2 + effective_spindles** → máy 8 core SSD: 16–20 connection là đủ cho một DB. Hàng nghìn connection là dấu hiệu thiết kế sai.
- Nhiều instance app × pool size = tổng connection; vượt max_connections → "too many clients". **PgBouncer** transaction pooling: app giữ hàng trăm connection ảo, PG chỉ thấy vài chục. Đổi lại mất session state: [[SET]] cấp session, prepared statement theo tên, [[LISTEN]], advisory lock session.
- Go [[database/sql]]: [[SetMaxOpenConns]] (mặc định **vô hạn**, phải đặt), [[SetMaxIdleConns]], [[SetConnMaxLifetime]] (ngắn hơn idle timeout của proxy/LB), [[SetConnMaxIdleTime]]. Triệu chứng pool đầy: latency tăng, DB CPU không tăng, [[WaitCount]] trong [[db.Stats()]] tăng.

#### statement_timeout và lock_timeout: đặt ở tầng nào
| Tầng | Lệnh | Phạm vi | Ưu tiên |
|---|---|---|---|
| Cluster | [[statement_timeout]] trong postgresql.conf | Toàn bộ | Thấp nhất |
| Database | [[ALTER DATABASE d SET statement_timeout = ...]] | Mọi session vào DB đó | Ghi đè cluster |
| Role | [[ALTER ROLE r SET statement_timeout = '90s']] | Mọi session login bằng role | Ghi đè database |
| Session | [[SET statement_timeout = '30s']] | Connection hiện tại; qua PgBouncer transaction pooling sẽ **rò sang client khác** | Ghi đè role |
| Transaction | [[SET LOCAL statement_timeout = '5min']] | Chỉ trong BEGIN ... COMMIT | Cao nhất, an toàn với pooler |
- Sự cố #4: role trên Aurora có 90 s; Lambda chỉ [[SET LOCAL]] trong transaction nên mọi query autocommit ngoài transaction vẫn chịu 90 s và bị giết giữa chừng. Bài học: kiểm tra giá trị **đang có hiệu lực** bằng [[SHOW statement_timeout]] từ đúng role và đúng đường kết nối; chọn theo workload: API 5–30 s, batch/report mở transaction riêng với SET LOCAL dài; không bao giờ để 0 (vô hạn) cho API.
- [[lock_timeout]]: thời gian chờ lấy lock (migration 5 s). [[idle_in_transaction_session_timeout]]: giết tx treo (bật, 1–5 phút). [[deadlock_timeout]] 1 s.

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| Chiều cao B-tree cho 10^8 dòng | 3–4 tầng |
| Index đáng dùng khi lọc còn | ≲ 5–10% bảng |
| Pool khởi điểm | cores × 2 + spindles (~20 cho 8 core SSD) |
| RAM mỗi connection PG | ~5–10 MB |
| autovacuum ngưỡng mặc định | 20% + 50 dòng |
| deadlock_timeout | 1 s |
| Mã lỗi serialization failure | 40001 → retry |
| lock_timeout cho migration | 5 s |

### Sai lầm hay gặp
- Tạo index theo cảm tính, không EXPLAIN; index cột boolean; không biết partial index.
- [[SELECT *]] rồi lọc trong Go; ORM Preload toàn bộ quan hệ (sự cố #3); OFFSET lớn (bài F6).
- Read-modify-write ở Read Committed không khoá → lost update; không retry 40001 ở Repeatable Read/Serializable.
- Transaction dài hoặc idle in transaction → bloat, lock queue, connection bị giữ.
- Migration không [[lock_timeout]] → chặn production 10 phút vì một SELECT dài đứng trước.
- Pool không giới hạn; mỗi service 100 connection; không dùng pooler khi có 20 instance.
- statement_timeout đặt sai tầng; dùng SET cấp session sau PgBouncer; không biết role đang có giá trị gì (sự cố #4).

### Nói thế nào trong phỏng vấn (EN)
- "I'd start with EXPLAIN ANALYZE: if I see a sequential scan with most rows removed by the filter, the index is missing or not usable." — Tôi bắt đầu bằng EXPLAIN ANALYZE; Seq Scan với nhiều dòng bị filter là thiếu index.
- "A partial index on the pending rows keeps the index tiny and makes the sweeper query O(log n) instead of scanning millions of finished rows." — Partial index trên dòng pending giữ index nhỏ, query sweeper không quét hàng triệu dòng đã xong.
- "Postgres defaults to Read Committed, so a read-modify-write needs SELECT FOR UPDATE or an atomic UPDATE to avoid lost updates." — PG mặc định Read Committed nên read-modify-write cần FOR UPDATE hoặc UPDATE nguyên tử.
- "Pool size should be around twice the cores, not the number of goroutines; more connections just add contention." — Pool ≈ 2 × core, không phải số goroutine.
- "I set statement timeouts per transaction with SET LOCAL and keep them short for API paths, because role-level settings silently apply to everything." — Tôi đặt timeout per transaction bằng SET LOCAL và ngắn cho API, vì cài ở role áp lên mọi thứ một cách âm thầm.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Bật [[pg_stat_statements]] (nếu chưa) và lấy top 10 query theo total_time trên pilot; chạy [[EXPLAIN (ANALYZE, BUFFERS)]] cho 5 query đầu, ưu tiên bảng policy violation scopes 9,6 triệu dòng (sự cố #6) và ListAllPending của sweeper (sự cố #8/#16).
- Partial index [[idx_prcl_pending_rev]] đang tạo tay trên Canary RDS → đưa vào migration với [[CREATE INDEX CONCURRENTLY]] và [[lock_timeout]]; thêm index theo (tenant_id, policy_id, ...) cho bảng violation sau khi đọc plan thực.
- statement_timeout 3 tầng trên Aurora: [[SELECT rolname, rolconfig FROM pg_roles]], [[SELECT datname, ... FROM pg_db_role_setting]], và [[SHOW statement_timeout]] từ connection của apiserver, worker, Lambda. Quyết định và ghi ADR: API 30 s qua connect param; runner/batch bắt buộc mở transaction + SET LOCAL; không dựa vào role (sự cố #4). Nếu có PgBouncer thì cấm SET cấp session.
- Pool: liệt kê [[SetMaxOpenConns]] của từng service; tổng = instances × pool; so với [[max_connections]] Aurora và với công thức cores × 2. Bật [[idle_in_transaction_session_timeout = '5min']].
- Sweeper và scheduled job: [[SELECT ... FOR UPDATE SKIP LOCKED]] để nhiều worker không lấy trùng; [[pg_try_advisory_lock]] cho leader election của gocron (sự cố #9).
- Bloat: chạy [[pgstattuple]] trên bảng PRCL (update pending → done liên tục); đặt autovacuum per-table gắt hơn ([[autovacuum_vacuum_scale_factor = 0.02]]).
- Kiểm tra isolation ở chỗ reconcile policy (sự cố #14): một lần eval lỗi xoá mềm violation của lần eval tốt là lost update ở mức nghiệp vụ → cần version/run_id và điều kiện WHERE run_id = ... khi xoá.
`,
  quiz: [
    { t: 'mc', q: 'Có index composite trên (tenant_id, status, created_at). Query nào KHÔNG tận dụng được index này?', o: ['WHERE tenant_id = 1', "WHERE tenant_id = 1 AND status = 'pending'", "WHERE tenant_id = 1 AND status = 'pending' ORDER BY created_at", "WHERE status = 'pending'"], a: 3, why: 'Leftmost prefix: thiếu cột đầu tenant_id thì B-tree không dùng được để lọc status.' },
    { t: 'mc', q: 'Bảng 10 triệu dòng, 1% đang pending. Query sweeper WHERE status = pending ORDER BY updated_at LIMIT 100 chạy hàng phút. Cách sửa tốt nhất?', o: ['Tăng work_mem', 'Partial index trên (updated_at) WHERE status = pending', 'Index thường trên cột status', 'Chuyển sang OFFSET pagination'], a: 1, why: 'Partial index chỉ chứa 1% dòng và đã sắp theo updated_at, nên LIMIT 100 là đọc 100 entry đầu.' },
    { t: 'mc', q: 'Ở Read Committed, hai transaction cùng đọc balance = 100 rồi cùng UPDATE balance = 100 - 30. Hiện tượng gì?', o: ['Lost update', 'Dirty read', 'Phantom read', 'Deadlock'], a: 0, why: 'Một lần trừ bị ghi đè; cần UPDATE nguyên tử (x = x - 30) hoặc SELECT FOR UPDATE.' },
    { t: 'mc', q: 'statement_timeout = 90 s ở ALTER ROLE; code SET LOCAL 10 phút trong transaction. Một SELECT dài chạy autocommit ngoài transaction chịu timeout nào?', o: ['10 phút vì SET LOCAL ghi đè', 'Không có timeout vì ngoài transaction', '90 giây theo role', '30 giây mặc định của driver'], a: 2, why: 'SET LOCAL chỉ sống trong transaction; ngoài đó giá trị có hiệu lực là của role (sự cố #4).' },
    { t: 'mc', q: 'Pool connection hợp lý cho một app Go nối Postgres 8 core, SSD là khoảng bao nhiêu?', o: ['~20', '~200', '~2 000', 'Bằng số goroutine tối đa'], a: 0, why: 'cores × 2 + spindles ≈ 16–20; nhiều hơn chỉ thêm context switch và contention.' },
    { t: 'fill', q: 'Điền: lệnh Postgres dọn dead tuple do MVCC để lại và cập nhật visibility map là ___.', a: ['vacuum', 'autovacuum'], why: 'Không VACUUM được (do transaction dài) là nguyên nhân bloat và wraparound.' },
    { t: 'fill', q: 'Điền: mệnh đề thêm vào SELECT ... FOR UPDATE để worker bỏ qua dòng đang bị khoá thay vì chờ: ___.', a: ['skip locked', 'for update skip locked'], why: 'Pattern job queue trong Postgres: nhiều worker lấy việc song song không đụng nhau.' },
    { t: 'open', q: 'A list endpoint became slow as its table grew to 10 million rows. Walk me through how you diagnose and fix it.', a: 'First I reproduce with the real parameters and run EXPLAIN (ANALYZE, BUFFERS). If I see a Seq Scan with millions of rows removed by filter, the index is missing or unusable; I check the predicate for functions, type casts or leading wildcards and compare estimated versus actual rows to catch stale statistics. Then I design the index from the query: equality columns first, range or sort column last, a partial index if the query only touches a small status subset, and INCLUDE columns for an index-only scan. I also check the pagination style, since OFFSET on page 10 000 reads everything before it, and the pool stats to rule out connection waits. After creating the index CONCURRENTLY I re-run the plan and watch p99 and DB CPU.', keys: ['explain analyze', 'seq scan', 'index', 'statistics', 'pool'] }
  ]
},
{ id: 'F6', type: 'foundation', topic: 'api', title: 'Thiết kế API: REST, idempotency, pagination, versioning, lỗi, gRPC/GraphQL, webhook', time: '120 phút',
  goal: 'Thiết kế được một API REST hoàn chỉnh cho tác vụ có side effect: idempotency key cho POST, cursor pagination, error contract có trace id, 202 + job resource cho việc dài, webhook ký HMAC; và nói được khi nào chọn gRPC hay GraphQL thay REST.',
  md: `
### Vấn đề cần giải
API là hợp đồng giữa bạn và client: FE, khách hàng tích hợp, service khác. Hợp đồng kém thì client retry tạo bản ghi hai lần, export trang 10 000 chậm 30 giây và ăn hết RAM (sự cố #11), lỗi 500 không có trace id nên support mò cả buổi, đổi tên một field làm vỡ hệ thống khách đang chạy. Thiết kế API tốt là thiết kế **cho lỗi, cho retry và cho thay đổi**, không phải cho happy path.

### Cốt lõi
#### Resource modeling và HTTP semantics
- Danh từ số nhiều, phân cấp nông (tối đa 2 cấp): [[/projects/{id}/components]]. Hành động không phải CRUD → sub-resource hoặc verb rõ ràng: [[POST /projects/{id}/scans]] thay vì [[POST /scanProject]].
| Method | Safe | Idempotent | Dùng cho | Status thường gặp |
|---|---|---|---|---|
| GET | có | có | Đọc | 200, 304, 404 |
| POST | không | **không** | Tạo, hành động | 201 + Location, 202, 200 |
| PUT | không | có | Thay thế toàn bộ | 200, 204 |
| PATCH | không | không (có thể thiết kế thành có) | Cập nhật một phần | 200 |
| DELETE | không | có | Xoá | 204 (xoá lần 2 vẫn 204 hoặc 404) |
- Status: 400 sai cú pháp; 401 chưa xác thực; 403 không có quyền; 404; 409 conflict (trùng, version lệch); 422 đúng cú pháp sai nghiệp vụ; 429 rate limit; 500 lỗi server; 502/503/504 upstream lỗi/quá tải/timeout. 503 kèm [[Retry-After]] là tín hiệu cho client lùi lại.

#### Idempotency key cho POST
- Vấn đề: client gửi [[POST /payments]], timeout, không biết server đã xử lý chưa → retry → hai giao dịch. Network không phân biệt "chưa tới" và "đã tới nhưng response mất".
- Giải: client sinh header [[Idempotency-Key]] là một UUID; server lưu key → (hash request, trạng thái, response) với TTL ~24 giờ, scope theo tenant/user. Gặp key cũ cùng payload → trả lại response cũ (cùng status code); cùng key khác payload → 422; key đang xử lý dở → 409 hoặc chờ. Lưu key **trong cùng transaction** với dữ liệu để không có khe hở giữa "đã ghi" và "đã nhớ key".
- Áp dụng cho mọi POST có side effect (tạo đơn, upload, gửi mail, trigger scan). PUT/DELETE vốn idempotent về trạng thái nhưng side effect kèm theo (gửi notification) vẫn phải tự kiểm tra.

#### Pagination: offset vs cursor/keyset
| | Offset | Cursor / keyset |
|---|---|---|
| Request | [[?page=100&size=50]] → [[OFFSET 4950 LIMIT 50]] | [[?cursor=eyJ...&limit=50]] → [[WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 50]] |
| Chi phí | O(n): trang 10 000 đọc và bỏ 500 000 dòng; COUNT(*) đắt | O(log n) mọi trang nhờ index trên (created_at, id) |
| Ổn định | Trôi/trùng dòng khi có insert/delete giữa hai trang | Ổn định, phù hợp export và feed |
| Hạn chế | Chậm dần theo trang | Không nhảy tới trang N; cần sort key duy nhất (thêm id làm tie-breaker); lọc/sort động phức tạp hơn |
| Dùng khi | Bảng nhỏ, admin UI, dữ liệu tĩnh | API public, feed, export, bảng lớn |
- Cursor là chuỗi opaque (base64 của (created_at, id)) để client không tự chế. Luôn trả [[next_cursor]] (null khi hết), giới hạn [[limit]] tối đa 100–1 000, không hứa total chính xác (hoặc trả estimate).
- Sự cố #11: export dùng OFFSET + join qua FDW + ReadAll vào RAM. Fix: keyset + stream từng trang ra response (chunked/NDJSON hoặc ghi file lên S3 rồi trả link) + không bao giờ giữ toàn bộ kết quả trong RAM.

#### Versioning
| Cách | Ưu | Nhược |
|---|---|---|
| URL [[/v1/...]] | Rõ ràng, dễ route/cache/test | URL "xấu", dễ copy toàn bộ code sang v2 |
| Header [[Accept: application/vnd.sbom.v2+json]] | URL sạch | Khó test bằng browser, cache phải Vary |
| Không version, chỉ thay đổi additive | Ít gánh nặng nhất | Đòi kỷ luật: không xoá/đổi tên/đổi kiểu |
- Rule: thêm field optional, thêm endpoint, thêm giá trị enum (client phải tolerant) → **không cần** version. Bỏ/đổi nghĩa/đổi kiểu → version mới + header [[Deprecation]]/[[Sunset]] + thời hạn 6–12 tháng + log xem ai còn gọi bản cũ. Client là **tolerant reader**: bỏ qua field lạ.

#### Error contract
~~~json
{ "error": { "code": "E040022", "message": "Resource instance not found",
             "details": [{ "field": "projectId", "issue": "unknown" }],
             "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736" } }
~~~
- [[code]] cho máy đọc, ổn định, có tài liệu; [[message]] cho developer, không phải cho end user; [[details]] theo field; [[trace_id]] khớp log/OTel để support tra một phát. Chuẩn sẵn: RFC 9457 Problem Details ([[application/problem+json]]: type, title, status, detail, instance).
- Không lộ stack trace/SQL (sự cố #5: lỗi FDW "column does not exist" không được chui ra ngoài nguyên văn); 500 vẫn phải có trace_id; không dùng 200 kèm [[success: false]].

#### Rate limiting, bulk, long-running
- 429 + [[Retry-After]] + header [[RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset]]. Thuật toán token bucket (cho phép burst) hoặc sliding window (Redis INCR + EXPIRE hoặc sorted set). Giới hạn theo tenant/API key, không chỉ theo IP (khách đi qua NAT chung IP).
- Bulk: [[POST /components:batchGet]] với mảng id (giới hạn 100–1 000); response per-item status (200 với mảng kết quả/lỗi, hoặc 207). Thay N request nhỏ = N RTT bằng 1 request.
- Long-running (parse SBOM mất vài phút): [[POST /sboms]] → **202 Accepted** + [[Location: /jobs/{id}]]; [[GET /jobs/{id}]] → { status: queued | running | succeeded | failed, progress, result_url, error }; client poll với backoff, hoặc nhận webhook/SSE. Không giữ HTTP mở 5 phút: LB timeout 60 s sẽ cắt, client thấy 504 còn job vẫn chạy.

#### Webhook
- Server gọi ngược client: [[POST]] JSON { id, type, occurred_at, data } tới URL khách đăng ký.
- Ký: header [[X-Signature: t=1700000000, v1=HMAC-SHA256(secret, timestamp + "." + body)]]; khách verify và từ chối nếu timestamp lệch > 5 phút (chống replay). Secret per-endpoint, rotate được, không bao giờ gửi qua query string.
- Retry: khách phải trả 2xx nhanh (xử lý async); server retry exponential backoff (1 phút, 5 phút, 30 phút, 2 giờ... tối đa 24–72 giờ) rồi đánh dấu endpoint failed và hiện dashboard. Vì sẽ giao trùng, khách phải idempotent theo [[id]]; không đảm bảo thứ tự nên kèm [[occurred_at]]/version. Cung cấp log delivery và nút resend.

#### REST vs gRPC vs GraphQL
| Tiêu chí | REST/JSON | gRPC | GraphQL |
|---|---|---|---|
| Transport | HTTP/1.1–2, text | HTTP/2, protobuf binary | HTTP POST, JSON |
| Hiệu năng | Vừa, payload lớn hơn | Cao, nhỏ, streaming hai chiều | Phụ thuộc resolver, dễ N+1 |
| Contract | OpenAPI (tuỳ chọn) | .proto bắt buộc, codegen đa ngôn ngữ | Schema bắt buộc, introspection |
| Caching | HTTP cache/CDN tự nhiên | Khó | Khó (POST), cần persisted query |
| Hợp với | Public API, browser, đối tác | Service-to-service nội bộ, mobile có SDK | FE nhiều màn hình lắp ghép dữ liệu, nhiều loại client |
| Nhược | Over/under-fetching, versioning | Browser cần grpc-web, LB phải hiểu HTTP/2 | Rate limit theo độ phức tạp khó, cache khó, server phức tạp |
Rule: public → REST; nội bộ nhiều service Go → gRPC; FE phức tạp → GraphQL hoặc BFF (backend-for-frontend) REST. Không có lý do "hiện đại hơn".

### Sai lầm hay gặp
- POST không idempotency key rồi FE/khách retry → bản ghi trùng.
- OFFSET cho export/feed; không giới hạn limit; COUNT(*) mỗi trang (sự cố #11).
- Trả 200 cho lỗi; 500 không trace_id; lộ SQL/stack trace ra ngoài.
- Đổi tên field "cho đẹp" → vỡ client của khách; không có Sunset header, không log ai còn dùng bản cũ.
- Webhook không ký, không retry, không id → khách mất event hoặc xử lý hai lần.
- HTTP request chờ job 5 phút → LB cắt ở 60 s → client thấy 504, job vẫn chạy, client retry → job chạy hai lần.
- Rate limit theo IP khi khách đi qua NAT; không trả Retry-After.

### Nói thế nào trong phỏng vấn (EN)
- "Any POST with side effects accepts an Idempotency-Key; we store the key with the response for 24 hours so retries are safe." — POST có side effect nhận Idempotency-Key, lưu kèm response 24 giờ để retry an toàn.
- "For large or frequently changing collections I use keyset pagination with an opaque cursor; offset pagination degrades linearly with page depth." — Tập dữ liệu lớn dùng keyset với cursor opaque; offset chậm tuyến tính theo độ sâu trang.
- "Parsing takes minutes, so the upload returns 202 with a job resource the client polls or gets a webhook for." — Parse mất vài phút nên upload trả 202 với job resource để client poll hoặc nhận webhook.
- "Errors return a stable machine-readable code, a message, field-level details and a trace id that maps to our logs." — Lỗi trả code ổn định, message, chi tiết theo field và trace id khớp log.
- "We only version on breaking changes; additive changes ship under the same version with tolerant-reader clients." — Chỉ version khi breaking; thay đổi additive giữ nguyên version.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Upload SBOM: xác nhận endpoint trả **202 + job resource** (revision/scan id) và FE poll với backoff thay vì giữ request qua Nginx Proxy Manager 60 s; nếu hiện tại là 200 đồng bộ thì đây là lý do của các 504 lẻ tẻ khi file lớn.
- Thêm [[Idempotency-Key]] cho POST upload và POST trigger scan: client retry sau 504 hiện tạo thêm revision trùng không? Kiểm tra bằng cách replay cùng request hai lần trên local.
- Export (sự cố #11): đổi sang keyset pagination theo (created_at, id), stream NDJSON/CSV theo trang 1 000 dòng, bỏ ReadAll; với export rất lớn ghi file lên S3/MinIO rồi trả presigned URL qua job resource.
- Error contract: mã E0400xx đã có; bảo đảm mọi response lỗi (kể cả 500 từ middleware recover) có [[trace_id]] trùng với span OTel; lọc message lỗi DB/FDW nguyên văn trước khi trả (sự cố #5).
- Khách Nhật tích hợp API: viết chính sách versioning 1 trang (additive-only, Deprecation/Sunset 6 tháng, log user-agent theo version) và gắn vào tài liệu OpenAPI.
- Rate limit theo tenant cho upload/export: 429 + Retry-After, token bucket trong Redis; đo trước 1 tuần để chọn ngưỡng không chặn khách thật.
- Webhook "scan completed / critical vulnerability found" cho khách: HMAC-SHA256 kèm timestamp, event id, retry backoff, bảng delivery log; đi cùng outbox (bài F8) để không mất event.
`,
  quiz: [
    { t: 'mc', q: 'Client timeout sau khi gửi POST /orders rồi retry. Cách đúng để không tạo hai đơn?', o: ['Dùng PUT thay cho POST', 'Idempotency-Key do client sinh; server lưu key kèm response với TTL và trả lại response cũ khi gặp lại', 'Tăng timeout client lên 60 giây', 'Trả 202 và xử lý bất đồng bộ'], a: 1, why: 'Server nhớ key và kết quả nên request lặp lại không tạo side effect mới; timeout lớn hay 202 không giải quyết trùng.' },
    { t: 'mc', q: 'Export 2 triệu dòng bằng OFFSET pagination chậm dần theo từng trang. Nguyên nhân chính?', o: ['DB phải đọc rồi bỏ qua mọi dòng đứng trước offset ở mỗi trang', 'JSON encode chậm theo kích thước', 'Index bị bloat theo thời gian', 'HTTP/1.1 không hỗ trợ response lớn'], a: 0, why: 'OFFSET N là O(N) mỗi lần; keyset dùng điều kiện WHERE trên sort key nên O(log n).' },
    { t: 'mc', q: 'Thay đổi nào sau đây đòi hỏi phát hành version API mới?', o: ['Thêm field optional vào response', 'Thêm endpoint mới', 'Thêm query parameter optional', 'Đổi kiểu field id từ number sang string'], a: 3, why: 'Đổi kiểu là breaking change; các thay đổi additive không phá client tolerant reader.' },
    { t: 'mc', q: 'Vì sao chữ ký webhook dùng HMAC kèm timestamp?', o: ['Để nén payload', 'Để sắp xếp thứ tự event', 'Để xác thực nguồn gửi và chống replay request cũ', 'Để mã hoá payload'], a: 2, why: 'HMAC chứng minh người gửi có secret; timestamp trong chữ ký khiến request cũ bị từ chối.' },
    { t: 'mc', q: 'Request parse SBOM mất khoảng 3 phút. Thiết kế API nào phù hợp?', o: ['Giữ HTTP mở tới khi xong và tăng timeout của load balancer', 'Trả 200 ngay, client tự reload trang để xem', 'Chia file thành nhiều request nhỏ cho client tự ghép', 'Trả 202 Accepted kèm Location tới job resource; client poll hoặc nhận webhook'], a: 3, why: 'Việc dài tách khỏi vòng đời HTTP; LB và client không phải giữ connection phút này qua phút khác.' },
    { t: 'fill', q: 'Điền: kiểu pagination dùng điều kiện WHERE (created_at, id) < (...) thay vì OFFSET gọi là ___ pagination.', a: ['keyset', 'cursor', 'cursor-based', 'seek', 'cursor based'], why: 'Keyset/cursor pagination ổn định và O(log n) nhờ index trên sort key.' },
    { t: 'fill', q: 'Điền: mã HTTP trả về khi client vượt rate limit, thường kèm header Retry-After, là ___.', a: ['429', '429 too many requests', 'too many requests'], why: '429 Too Many Requests; 503 dành cho server quá tải nói chung.' },
    { t: 'open', q: 'Design the API for uploading an SBOM file and retrieving its analysis results.', a: 'POST /projects/{id}/sboms accepts the file (or a presigned-URL handshake for large files) with an Idempotency-Key so client retries do not create duplicate revisions; it validates quickly and returns 202 Accepted with Location: /jobs/{jobId}. GET /jobs/{jobId} returns status, progress, and when done a link to GET /projects/{id}/revisions/{rev}/components, which uses cursor pagination with a max limit and filters. Errors follow one contract with a stable code, message, details and trace id. For integrations I add a webhook on scan.completed signed with HMAC and timestamp, retried with backoff, idempotent by event id, and published through an outbox so it is never lost.', keys: ['202', 'idempotency', 'job', 'cursor', 'webhook'] }
  ]
},
{ id: 'F7', type: 'foundation', topic: 'cache', title: 'Caching: chiến lược, TTL, eviction, stampede, hot key, nhất quán', time: '120 phút',
  goal: 'Chọn đúng chiến lược cache cho từng loại dữ liệu, chống được stampede/hot key/penetration bằng kỹ thuật cụ thể (singleflight, jitter, negative cache), và nói rõ cửa sổ không nhất quán mình chấp nhận.',
  md: `
### Vấn đề cần giải
RAM ~100 ns, Redis qua mạng ~0,3 ms, Postgres ~1–10 ms cho một query thật: cache tồn tại để trả lời 80–95% request từ tầng nhanh và **bảo vệ DB**, tầng khó scale nhất. Nhưng cache là bản sao, bản sao thì cũ; và khi cache hỏng hệ thống vẫn phải sống. Sự cố #2: Lambda mất biến REDIS_HOST sau redeploy, client fallback về localhost, enrichment pending kẹt hàng giờ — cache không tới được đã biến thành sự cố dừng dịch vụ thay vì chỉ chậm đi.

### Cốt lõi
#### Kiến trúc nhiều tầng
:::diagram
Client[Browser / App] -> CDN[CDN edge] : static, GET public
CDN -> API[API server Go]
API -> L1[Local cache in-process] : TTL 1-5 s, hot key
L1 -> Redis[Redis] : cache-aside
Redis -> DB[Postgres]
API -> DB : miss hoặc write
:::
Mỗi tầng xa hơn chậm hơn 10–100× nhưng lớn hơn và nhất quán hơn. Hit ratio của từng tầng nhân lên: 90% ở L1 và 90% ở Redis nghĩa là chỉ 1% request chạm DB.

#### Chiến lược đọc/ghi
| Chiến lược | Luồng | Ưu | Nhược | Dùng khi |
|---|---|---|---|---|
| Cache-aside (lazy) | Đọc cache → miss → đọc DB → set cache. Ghi: ghi DB → **xoá** key | Linh hoạt; cache chết app vẫn chạy; chỉ cache thứ được đọc | Miss đầu chậm; stale tới khi invalidate/TTL; logic lặp ở mọi nơi | Mặc định cho dữ liệu đọc nhiều |
| Read-through | Cache tự load từ DB khi miss (thư viện/proxy) | Code gọn | Phụ thuộc thư viện; cùng vấn đề stale | Khi đã có lớp cache library |
| Write-through | Ghi cache và DB đồng bộ | Cache luôn mới, đọc-sau-ghi đúng | Ghi chậm hơn; cache chứa thứ không ai đọc | Dữ liệu ghi ít đọc nhiều cần nhất quán (config, profile) |
| Write-behind | Ghi cache, flush DB bất đồng bộ theo lô | Ghi cực nhanh, gộp write | Mất dữ liệu nếu cache chết trước flush | Counter, like, metric không cần bền tuyệt đối |
| Refresh-ahead | Tự làm mới trước khi hết hạn | Không có miss cho key nóng | Tốn công làm mới thứ không ai đọc | Key rất nóng, biết trước |

#### TTL, jitter, eviction
- TTL là công cụ nhất quán cuối cùng (bound staleness): chấp nhận cũ 5 phút thì TTL 5 phút. Không TTL = rò rỉ bộ nhớ và stale vĩnh viễn.
- **Jitter**: TTL × (1 ± 10–20%) để các key không hết hạn đồng loạt (warm cache lúc deploy → đúng 10 phút sau tất cả miss cùng lúc).
| Eviction policy | Ý nghĩa | Ghi chú |
|---|---|---|
| LRU ([[allkeys-lru]]) | Loại key ít dùng gần nhất | Redis xấp xỉ bằng sampling; mặc định hợp lý |
| LFU ([[allkeys-lfu]]) | Loại key ít dùng nhất theo tần suất | Chống "quét một lần" đẩy bay hot key; Redis 4+ |
| FIFO / random | Đơn giản | Hiếm khi tốt hơn LRU |
| [[volatile-ttl]] | Loại key sắp hết hạn trước | Chỉ xét key có TTL |
| [[noeviction]] | Lệnh ghi lỗi OOM khi đầy | App phải chịu được lỗi ghi cache |
- Theo dõi [[evicted_keys]]: eviction cao nghĩa là cache nhỏ hơn working set → hit ratio tụt → DB chịu tải.

#### Cache stampede (dogpile)
- Key nóng hết hạn → 1 000 request cùng miss → 1 000 query giống hệt xuống DB → DB chậm → càng nhiều miss. Hay xảy ra sau deploy, flush, Redis restart.
- Giải pháp, dùng kết hợp: (1) **lock**: [[SET lock:key 1 NX PX 3000]] → chỉ một request đi tính, số còn lại chờ hoặc trả bản cũ; (2) **singleflight** ([[golang.org/x/sync/singleflight]]): gộp các goroutine cùng key trong một process thành một lần gọi; qua nhiều instance vẫn N lần nên kết hợp lock Redis; (3) **early recompute xác suất** (XFetch): càng gần hết hạn càng có xác suất tự làm mới trước; (4) **stale-while-revalidate**: lưu TTL logic trong value, hết TTL logic thì trả bản cũ và một goroutine làm mới; (5) warm cache trước khi nhận traffic.

#### Hot key, penetration, big key
- **Hot key**: một key chiếm phần lớn traffic → một shard Redis (~100 000 ops/s) nghẽn trong khi shard khác rảnh. Giải: local in-process cache (L1) TTL 1–5 s; nhân bản key [[key#0..key#9]] đọc ngẫu nhiên; tách key theo chiều (per-region, per-tenant).
- **Penetration**: query id không tồn tại (bot, dữ liệu đã xoá) → luôn miss → luôn xuống DB. Giải: **negative cache** ("not found" với TTL ngắn 30–60 s), **bloom filter** trước cache (có false positive nhỏ, không false negative), validate input để loại id sai định dạng từ sớm.
- **Big key**: hash/list vài trăm MB → [[HGETALL]] block Redis single-thread vài trăm ms, mọi client chờ. Giải: tách nhỏ, dùng [[HSCAN]]/[[SSCAN]], giữ value ≤ 100 KB.

#### Invalidation và cửa sổ không nhất quán
- Ghi DB rồi **DELETE** key, không SET giá trị mới: hai writer đua nhau SET có thể để lại giá trị cũ hơn thắng; DELETE buộc lần đọc sau nạp từ DB.
- Race còn lại: A miss → đọc DB được v1; B ghi v2 → xoá key; A set cache v1 → stale tới hết TTL. Giảm bằng TTL ngắn, delayed double delete (xoá lại sau ~500 ms), hoặc **versioned key** (key kèm version/updated_at lấy từ DB → không bao giờ ghi đè nhầm).
- Ghi cache và DB không atomic nên luôn có inconsistency window. Câu trả lời senior: nói rõ cửa sổ bao lâu và dữ liệu nào chịu được (danh sách component cũ 1 phút: được; số dư, quyền truy cập: không).
- Dữ liệu quan trọng: invalidation theo sự kiện (outbox/CDC, bài F8); còn lại dựa vào TTL.

#### Redis: cấu trúc dữ liệu và khi nào dùng
| Cấu trúc | Lệnh chính | Dùng cho |
|---|---|---|
| String | GET/SET/INCR/SETNX | Cache JSON, counter, lock, session |
| Hash | HSET/HGET/HINCRBY | Object nhiều field, cập nhật từng field |
| List | LPUSH/RPOP/BRPOP | Queue đơn giản, N item gần nhất (LTRIM) |
| Set | SADD/SISMEMBER/SINTER | Tag, tập unique nhỏ, giao/hợp |
| Sorted set | ZADD/ZRANGEBYSCORE/ZREM | Leaderboard, sliding-window rate limit, delayed job (score = thời điểm chạy) |
| HyperLogLog | PFADD/PFCOUNT | Đếm unique xấp xỉ: sai số 0,81%, 12 KB bất kể N |
| Bitmap | SETBIT/BITCOUNT | Cờ theo id dày đặc: DAU 10 triệu user = 1,2 MB |
| Stream | XADD/XREADGROUP/XACK | Log/queue có consumer group, at-least-once |
- Redis thực thi lệnh **đơn luồng**: một lệnh O(N) lớn ([[KEYS *]], [[SMEMBERS]] set 1 triệu) chặn tất cả. Dùng [[SCAN]], pipeline để giảm RTT, Lua/MULTI cho nhiều lệnh nguyên tử.

#### Persistence và cluster (sơ lược)
- **RDB**: snapshot định kỳ (fork) → restart nhanh, mất dữ liệu kể từ snapshot cuối (phút). **AOF**: ghi mọi lệnh; [[appendfsync everysec]] mất ≤ 1 s, [[always]] chậm; rewrite định kỳ. Thường bật cả hai. Cache thuần có thể tắt persistence, nhưng restart = cache rỗng = stampede (xem trên).
- **Sentinel**: failover tự động cho một master. **Cluster**: 16 384 hash slot chia cho nhiều master, mỗi master có replica; lệnh multi-key (MGET, Lua) phải cùng slot → hash tag [[{tenant:42}:components]]. Replication async nên failover có thể mất vài ghi cuối: Redis không phải nơi duy nhất giữ dữ liệu quan trọng (lock, rate limit counter mất là chấp nhận được không?).

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| Redis throughput | ~100 000 ops/s mỗi instance |
| RTT app → Redis cùng DC | 0,2–0,5 ms |
| HyperLogLog | 12 KB, sai số 0,81% |
| AOF everysec | mất tối đa ~1 s |
| Hit ratio mục tiêu (read-heavy) | > 90% |
| Jitter TTL | 10–20% |
| Value an toàn | ≤ 100 KB |
| L1 in-process TTL | 1–5 s |

### Sai lầm hay gặp
- Cache mọi thứ không TTL; "cache sẽ lo" nhưng không bao giờ đo hit ratio và evicted_keys.
- Sau khi ghi DB thì SET giá trị mới vào cache → race → stale lâu; đúng là DELETE.
- Không lock/singleflight → stampede sau mỗi deploy hoặc Redis restart.
- Redis chết là app chết: không timeout ngắn (50–100 ms), không fallback đọc DB/degrade. Sự cố #2 là dạng ngược: config sai dẫn tới kẹt hàng giờ thay vì báo lỗi ngay lúc khởi động.
- [[KEYS *]] trên production; big key; dùng Redis làm DB chính không persistence.
- Key không chứa tenant trong hệ multi-tenant → leak dữ liệu giữa tenant (cùng họ với sự cố #15 ở tầng DB).

### Nói thế nào trong phỏng vấn (EN)
- "I'd use cache-aside with a TTL plus jitter, and invalidate by deleting the key on write rather than overwriting it." — Tôi dùng cache-aside với TTL có jitter, invalidate bằng xoá key khi ghi thay vì ghi đè.
- "To avoid a stampede when a hot key expires, only one request recomputes, protected by a short lock or singleflight; others serve stale or wait." — Để tránh stampede khi key nóng hết hạn, chỉ một request tính lại dưới lock hoặc singleflight.
- "Non-existent IDs get a short negative cache entry, and a bloom filter in front stops most of them before Redis." — Id không tồn tại được negative cache ngắn, bloom filter chặn trước Redis.
- "The inconsistency window is bounded by the TTL, about a minute, which is acceptable for a component list but not for balances." — Cửa sổ không nhất quán bị chặn bởi TTL ~1 phút, chấp nhận được cho danh sách component.
- "Redis is single-threaded per command, so I avoid O(N) commands like KEYS and keep values small." — Redis đơn luồng theo lệnh nên tôi tránh lệnh O(N) và giữ value nhỏ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Liệt kê toàn bộ key Redis hiện có bằng [[SCAN]] (không KEYS): cái gì được cache, TTL bao nhiêu ([[TTL key]]), key có chứa tenant_id không. Key thiếu tenant là rủi ro cùng họ với sự cố #15.
- Đo trên canary: [[INFO stats]] → keyspace_hits/misses (hit ratio), [[evicted_keys]], [[maxmemory-policy]]; thêm histogram latency app → Redis vào OTel. Không có 3 số này thì mọi thảo luận cache là cảm tính.
- Sự cố #2: client Redis trong Lambda phải **validate env lúc cold start** và fail fast (log + metric redis_unreachable) thay vì fallback localhost; timeout lệnh 100 ms; khi Redis không tới được thì bỏ qua cache và gọi ClearlyDefined tiếp, không treo batch.
- License cache cho component phổ biến (log4j, lodash...) là hot key tự nhiên → L1 in-process trong worker/Lambda TTL vài phút; negative cache cho purl ClearlyDefined không có để không gọi lặp hàng nghìn lần (giảm cả cd_fetch_error).
- Cache danh sách policy và config tenant: thêm singleflight + jitter TTL; khi policy đổi thì DELETE key [[policy:{tenant}]], không SET.
- Redis trên canary là một instance: viết rõ trong runbook dữ liệu nào chỉ là cache (mất là chấp nhận) và dữ liệu nào không được mất (rate limit, lock) để quyết định persistence/HA.
`,
  quiz: [
    { t: 'mc', q: 'Sau deploy, Redis bị flush; 2 000 request/s cùng miss key cấu hình tenant và DB CPU lên 100%. Hiện tượng và cách chống?', o: ['Hot key — nhân bản key', 'Cache stampede — lock/singleflight, jitter TTL, warm cache', 'Cache penetration — bloom filter', 'Big key — tách nhỏ value'], a: 1, why: 'Nhiều request cùng tính lại một key là stampede; chỉ cho một request tính và các request khác chờ hoặc dùng bản cũ.' },
    { t: 'mc', q: 'Với cache-aside, sau khi UPDATE thành công vào DB nên làm gì với cache?', o: ['SET giá trị mới ngay để đọc sau ghi luôn đúng', 'Không làm gì, TTL sẽ lo', 'DELETE key để lần đọc sau nạp lại từ DB', 'Tăng TTL để giảm miss'], a: 2, why: 'DELETE tránh race hai writer ghi đè nhau với giá trị cũ; lần đọc tiếp theo nạp bản đúng.' },
    { t: 'mc', q: 'Bot gọi GET /components/{uuid-ngẫu-nhiên} 5 000 lần/giây với uuid không tồn tại; mọi request đều xuống DB. Giải pháp?', o: ['Tăng TTL của các key đang có', 'Chuyển sang write-through', 'Dùng LFU thay LRU', 'Negative cache cho kết quả not-found kết hợp bloom filter hoặc validate id'], a: 3, why: 'Đây là cache penetration: cache cả câu trả lời "không có" và chặn id không hợp lệ trước khi chạm DB.' },
    { t: 'mc', q: 'Đếm số user unique mỗi ngày trong 50 triệu user, chấp nhận sai 1%, tốn RAM ít nhất. Dùng cấu trúc nào?', o: ['Set', 'Sorted set', 'HyperLogLog', 'List'], a: 2, why: 'HyperLogLog cố định 12 KB với sai số 0,81%; Set tốn hàng trăm MB.' },
    { t: 'mc', q: 'Vì sao TTL của cache nên có jitter?', o: ['Để các key không hết hạn đồng loạt gây miss hàng loạt', 'Để Redis tiết kiệm RAM', 'Để LRU hoạt động chính xác hơn', 'Để tránh clock skew giữa các node'], a: 0, why: 'Key được set cùng lúc (sau deploy) sẽ hết hạn cùng lúc; jitter trải đều thời điểm miss.' },
    { t: 'fill', q: 'Điền: package Go gộp các lời gọi trùng key đang bay thành một lần gọi là golang.org/x/sync/___.', a: ['singleflight'], why: 'singleflight.Group.Do chống stampede trong một process.' },
    { t: 'fill', q: 'Điền: cấu trúc xác suất trả lời "chắc chắn không có" hoặc "có thể có", dùng để chặn cache penetration, là ___ filter.', a: ['bloom'], why: 'Bloom filter không có false negative nên id bị nó loại chắc chắn không tồn tại.' },
    { t: 'open', q: 'How would you cache the component list of a project, and what consistency do you accept?', a: 'I would use cache-aside in Redis keyed by tenant, project and revision, storing the serialized page with a TTL of a few minutes plus 10–20% jitter. Writes (a new revision or enrichment update) delete the affected keys rather than overwrite them. The hottest projects get an in-process L1 cache with a 1–5 second TTL, and recomputation is guarded by singleflight plus a short Redis lock to avoid a stampede after deploys. Missing project IDs get a short negative cache entry. The inconsistency window is bounded by the TTL, about a minute, which is fine for a component list; anything authorization-related bypasses the cache or is invalidated by event.', keys: ['cache-aside', 'ttl', 'invalidate', 'stampede', 'tenant'] }
  ]
},
{ id: 'F8', type: 'foundation', topic: 'queue', title: 'Hàng đợi và xử lý bất đồng bộ: delivery semantics, idempotent consumer, DLQ, backpressure, ordering', time: '120 phút',
  goal: 'Phân biệt at-most/at-least/exactly-once và thiết kế được consumer idempotent với DLQ và per-key ordering; giải thích được vì sao publish-before-commit sai, outbox giải quyết thế nào, và alert nào bắt được publisher chết im lặng.',
  md: `
### Vấn đề cần giải
Upload một SBOM rồi parse, enrich license qua API ngoài, enrich vulnerability từ 5 nguồn, đánh giá policy, gửi notification: vài phút việc không thể nằm trong một HTTP request. Hàng đợi tách "nhận yêu cầu" khỏi "làm việc": hấp thụ burst, retry, cô lập dependency chậm, scale consumer độc lập. Đổi lại message có thể **trùng, đến muộn, sai thứ tự, hoặc biến mất không tiếng động**. Sự cố #1: publisher RabbitMQ là singleton không reconnect sau khi broker bị recreate → mọi cron job im lặng nhiều ngày. Sự cố #12: audit log publish trước khi commit → consumer đọc không thấy dữ liệu → FK violation, mất log.

### Cốt lõi
#### Khi nào tách bất đồng bộ
| Giữ đồng bộ | Chuyển bất đồng bộ |
|---|---|
| Client cần kết quả ngay (login, đọc dữ liệu) | Client chỉ cần "đã nhận" (upload, gửi mail, enrich, báo cáo) |
| Việc dưới vài trăm ms, ít phụ thuộc ngoài | Việc dài, gọi API ngoài không ổn định, cần retry |
| Lỗi phải báo ngay cho người dùng | Lỗi có thể retry/DLQ, người dùng xem trạng thái sau |
| Đơn giản, dễ debug | Hấp thụ burst, scale riêng; thêm broker, trùng lặp, thứ tự, giám sát |

:::diagram
API[API server] -> X[Exchange / Topic] : publish sau commit
X -> Q[Queue / Partition]
Q -> C1[Consumer 1]
Q -> C2[Consumer 2]
C1 -> DB[Postgres] : ghi idempotent
C2 -> DB
Q -> DLQ[Dead-letter queue] : sau N lần fail
DLQ -> Replay[Replay tool + alert]
:::

#### Delivery semantics
| Semantics | Cách đạt | Hệ quả | Dùng khi |
|---|---|---|---|
| At-most-once | Ack trước khi xử lý, hoặc fire-and-forget | Có thể mất, không trùng | Metric, log không quan trọng |
| At-least-once | Ack **sau** khi xử lý xong; crash giữa chừng → giao lại | Không mất, **có trùng** → consumer phải idempotent | Mặc định cho mọi việc nghiệp vụ |
| Exactly-once | Chỉ trong phạm vi hẹp (Kafka transactions giữa các topic Kafka, Flink checkpoint) | End-to-end với DB/API ngoài là không thể tổng quát | Hiếm; thực tế là effectively-once |
- **Effectively-once = at-least-once + idempotent consumer**: lưu message id đã xử lý (UNIQUE) trong **cùng transaction** với side effect, hoặc thao tác tự idempotent ([[UPSERT]], [[UPDATE ... SET status = 'done' WHERE status = 'pending']]).

#### Ack, nack, redelivery, visibility timeout
- RabbitMQ: [[basic.ack]] khi xong; [[basic.nack requeue=true]] quay lại queue (nguy cơ vòng lặp nóng), [[requeue=false]] đi DLX; auto-ack = at-most-once. Flag [[redelivered]] báo message đã từng giao.
- SQS: nhận → ẩn trong **visibility timeout** (mặc định 30 s); xử lý xong [[DeleteMessage]]; quá hạn chưa xoá → hiện lại cho consumer khác. Việc dài → gia hạn bằng [[ChangeMessageVisibility]], hoặc đặt timeout ≈ 6 × thời gian xử lý trung bình.
- Kafka: không ack từng message; consumer commit offset sau khi xử lý xong batch; crash → đọc lại từ offset đã commit (trùng). Commit trước khi xử lý = at-most-once.
- Nguyên tắc: ack **chỉ sau khi side effect đã bền** (DB commit). Phải xử lý xong trước timeout/heartbeat; nếu không message bị giao lại trong khi bạn vẫn đang xử lý → hai bản chạy chồng.

#### Poison message và DLQ
- Message luôn fail (payload sai, bug, dữ liệu tham chiếu không có) → requeue vô hạn → chiếm consumer, chặn queue, log ngập. Sự cố #7 và #8 là biến thể ở dạng bảng: dòng lỗi vĩnh viễn chiếm chỗ "100 dòng cũ nhất" nên dòng mới không bao giờ tới lượt (zombie starvation).
- Giải: đếm số lần giao (RabbitMQ header [[x-death]], SQS [[maxReceiveCount]] với redrive policy, Kafka retry topic kèm header attempt) → sau 3–5 lần chuyển **DLQ**. DLQ phải có: alert khi depth > 0, màn hình xem payload, tool replay sau khi fix, retention.
- Phân loại lỗi: tạm thời (timeout, 503, 429 → retry với backoff) và vĩnh viễn (validation, không tìm thấy → DLQ ngay, không phí 5 lần retry).

#### Ordering
- Broker chỉ đảm bảo thứ tự trong **một partition/queue với một consumer**; nhiều consumer song song = mất thứ tự toàn cục; retry và DLQ cũng phá thứ tự.
- **Per-key ordering**: partition theo [[hash(key) mod N]] với key = project_id hoặc tenant_id → mọi event của một project vào cùng partition, cùng consumer, đúng thứ tự; song song giữa các key. RabbitMQ: consistent-hash exchange hoặc nhiều queue theo key. Trả giá: hot key làm lệch partition.
- Consumer phải chịu được out-of-order khi cần: so version/updated_at và bỏ qua event cũ hơn trạng thái hiện có; thiết kế event mang trạng thái đầy đủ (state-carrying) thay vì delta.

#### Backpressure, prefetch, consumer lag
- **Prefetch**: RabbitMQ [[basic.qos(prefetch_count)]] giới hạn số message chưa ack mỗi consumer (10–100 cho việc nhanh, 1–5 cho việc nặng); Kafka [[max.poll.records]] + [[max.poll.interval.ms]] (xử lý lâu quá bị coi là chết → rebalance → trùng).
- Consumer chậm thì queue dài: đó là mục đích của queue. Nhưng phải có giới hạn: max-length/overflow (RabbitMQ), retention (Kafka), hoặc producer bị chặn/trả 503 khi lag vượt ngưỡng. Bên trong consumer: worker pool bounded (semaphore), không spawn goroutine không giới hạn (sự cố #3).
- **Consumer lag** = số message chưa xử lý (Kafka: log end offset − committed offset; RabbitMQ: [[messages_ready]] + tuổi message cũ nhất). Là metric số 1: lag tăng đều → thiếu consumer; nhảy vọt → burst; **đứng yên khi queue có message → consumer chết**. Alert cả "lag cao" lẫn "không có message publish/consume trong X phút": cái sau bắt được sự cố #1.

#### Publish-before-commit và outbox
- Sai (sự cố #12): [[BEGIN; INSERT audit_log; publish(event); COMMIT]] → consumer nhận event, SELECT theo id → chưa có (tx chưa commit) hoặc FK violation → drop → mất log. Đảo thành "commit rồi publish" vẫn có khe: commit xong, process chết trước khi publish → mất event.
- **Transactional outbox**: trong cùng tx ghi dữ liệu và một dòng vào bảng [[outbox(id, aggregate_id, type, payload, created_at, published_at)]] → COMMIT; một relay riêng poll outbox theo id (hoặc CDC/Debezium đọc WAL) publish rồi đánh dấu published. Đảm bảo at-least-once giữa DB và broker; consumer idempotent lo phần trùng. Chi tiết (poll vs CDC, dọn bảng, thứ tự) ở bài B7.
- Phía consumer: **inbox** [[processed_messages(message_id UNIQUE)]] ghi cùng tx với side effect.

#### Publisher reconnect
- AMQP connection/channel chết khi broker restart hoặc bị Watchtower recreate. Thư viện [[amqp091-go]] **không tự reconnect**: phải lắng nghe [[NotifyClose]], tạo lại connection + channel + declare với backoff; bật **publisher confirms** để biết message đã tới broker; khi disconnected thì ghi outbox/buffer thay vì nuốt; health check "connected" và metric [[publish_total]] → alert khi rate về 0. Sự cố #1: singleton không reconnect, mọi cron publish vào channel chết, không lỗi, không log, không ai biết.

#### RabbitMQ vs Kafka vs SQS
| Tiêu chí | RabbitMQ | Kafka | SQS |
|---|---|---|---|
| Mô hình | Smart broker (exchange, routing); xoá sau ack | Log phân tán; consumer giữ offset; replay được | Hàng đợi managed; visibility timeout |
| Thứ tự | Theo queue, mất khi nhiều consumer | Theo partition, bền | FIFO queue theo message group (300 msg/s/group); standard không |
| Throughput | Hàng chục nghìn msg/s mỗi node | Hàng trăm nghìn–triệu msg/s; hàng chục MB/s mỗi partition | Gần như không giới hạn (standard) |
| Retention / replay | Không | Có, theo thời gian hoặc kích thước | Tối đa 14 ngày; không replay sau delete |
| DLQ / delay | DLX, TTL, delayed plugin | Tự làm (retry topic) | Redrive policy; delay tối đa 15 phút |
| Dùng khi | Task queue, routing phức tạp, ít ops | Event streaming, nhiều consumer đọc lại, throughput lớn | Trên AWS, không muốn vận hành broker |

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| SQS visibility timeout | mặc định 30 s, tối đa 12 giờ |
| SQS retention | mặc định 4 ngày, tối đa 14 |
| Kafka partition | ~10–50 MB/s |
| Prefetch | 10–100 việc nhanh; 1–5 việc nặng |
| Chuyển DLQ sau | 3–5 lần |
| Alert "no publish/consume" | X = 2–3 × chu kỳ cron |

### Sai lầm hay gặp
- Auto-ack cho việc nghiệp vụ: at-most-once không chủ đích.
- Consumer không idempotent rồi ngạc nhiên vì trùng; không có inbox/UNIQUE.
- Requeue vô hạn không DLQ; có DLQ nhưng không ai alert hay xem.
- Publish trước commit (sự cố #12); không outbox cho event quan trọng.
- Publisher singleton không reconnect, không confirms, không alert khi publish rate = 0 (sự cố #1).
- Prefetch quá lớn: một consumer ôm 1 000 message, chết là 1 000 message chờ tới timeout.
- Mong thứ tự toàn cục với nhiều consumer; chọn Kafka cho task queue 100 msg/s vì "scale".

### Nói thế nào trong phỏng vấn (EN)
- "I design for at-least-once delivery and make every consumer idempotent, storing the message id in the same transaction as the side effect." — Tôi thiết kế at-least-once và làm consumer idempotent, lưu message id cùng transaction.
- "Poison messages go to a dead-letter queue after three attempts, with an alert on its depth and a replay tool." — Message hỏng sang DLQ sau 3 lần, alert theo depth, có tool replay.
- "Ordering is per key: I partition by project id so one project's events are sequential while projects run in parallel." — Thứ tự theo key: partition theo project id.
- "Publishing inside the transaction races the consumer against the commit; the transactional outbox fixes that." — Publish trong transaction là đua với commit; outbox giải quyết.
- "Consumer lag and 'no messages processed in the last N minutes' are my two primary alerts, because a dead publisher produces no errors at all." — Lag và "không có message trong N phút" là hai alert chính, vì publisher chết không sinh lỗi nào.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Viết lại AMQP publisher (sự cố #1): goroutine giám sát [[NotifyClose]], reconnect với backoff 1 s → 30 s, khai báo lại exchange/queue, bật publisher confirms; metric [[rabbitmq_publish_total]] và [[rabbitmq_connected]]; alert khi publish rate = 0 trong 15 phút ở giờ có cron.
- Audit log (sự cố #12): chuyển sang outbox — bảng [[t_outbox]] ghi cùng transaction với [[t_audit_logs]]; relay poll theo id, publish, set published_at; consumer Bento idempotent theo event id. Xoá hẳn lệnh publish trong transaction.
- Khai báo DLX cho các queue chính; [[x-death]] ≥ 3 → DLQ; dashboard RabbitMQ management + alert depth > 0; script replay có xác nhận.
- Prefetch theo loại việc: enrich/policy nặng 2–5, notification 50; đo lại thời gian xử lý trung bình để chọn.
- Lambda env (sự cố #2): validate RABBITMQ_* và REDIS_HOST lúc cold start, fail fast với log rõ ràng và metric, không fallback localhost; alert khi Lambda error rate tăng sau redeploy.
- Sweeper (sự cố #8): thay "100 dòng cũ nhất" bằng [[FOR UPDATE SKIP LOCKED]] + cột attempt_count/next_retry_at với backoff; dòng không có purl → trạng thái [[no_locator]] rời khỏi pending; đo số dòng xử lý mỗi lượt sau khi sửa.
- Metric per queue: messages_ready, tuổi message cũ nhất, consumer count; thêm vào dashboard canary trước khi làm bất kỳ tối ưu nào.
`,
  quiz: [
    { t: 'mc', q: 'Consumer ack ngay khi nhận message rồi mới xử lý. Đây là semantics nào?', o: ['At-most-once', 'At-least-once', 'Exactly-once', 'Effectively-once'], a: 0, why: 'Crash sau ack trước khi xử lý xong thì message mất; không bao giờ trùng nhưng có thể mất.' },
    { t: 'mc', q: 'Cách thực tế để đạt effectively-once end-to-end với side effect trong DB?', o: ['Bật chế độ exactly-once của broker là đủ', 'Dùng at-most-once rồi retry phía producer', 'At-least-once cộng consumer idempotent ghi message id cùng transaction với side effect', 'Giảm prefetch về 1 và chỉ dùng một consumer'], a: 2, why: 'Exactly-once của broker không bao phủ DB ngoài; idempotent consumer biến trùng thành vô hại.' },
    { t: 'mc', q: 'Service publish event AuditLogCreated bên trong transaction trước COMMIT; consumer đọc DB theo id không thấy dòng. Fix đúng?', o: ['Thêm sleep 1 giây ở consumer', 'Publish sau COMMIT là đủ tuyệt đối', 'Transactional outbox: ghi event cùng transaction, relay publish sau commit', 'Đổi RabbitMQ sang Kafka'], a: 2, why: 'Outbox làm việc ghi dữ liệu và việc phát event cùng commit hoặc cùng rollback; publish-sau-commit vẫn mất event nếu process chết giữa hai bước.' },
    { t: 'mc', q: 'Cần mọi event của cùng một project xử lý đúng thứ tự nhưng vẫn song song giữa các project. Thiết kế nào?', o: ['Một consumer duy nhất cho toàn hệ thống', 'Priority queue theo project', 'Sắp xếp lại ở consumer bằng timestamp đồng hồ', 'Partition theo hash(project_id), mỗi partition một consumer'], a: 3, why: 'Thứ tự chỉ được đảm bảo trong một partition; hash theo key cho đúng thứ tự theo key và song song giữa các key.' },
    { t: 'mc', q: 'Queue có 50 000 message, consumer process đang chạy nhưng lag không giảm và không có log lỗi. Khả năng cao nhất?', o: ['Message quá nhỏ nên broker không giao', 'Consumer kẹt (chờ external call không timeout) hoặc channel/connection đã chết im lặng', 'Prefetch quá thấp', 'Broker quá tải'], a: 1, why: 'Lag đứng yên khi có message là dấu hiệu consumer không tiêu thụ; không có lỗi vì không có gì được thử.' },
    { t: 'fill', q: 'Điền: hàng đợi nhận các message đã thất bại sau N lần xử lý, để xem xét và replay, gọi là ___ (viết tắt 3 chữ cũng được).', a: ['dlq', 'dead letter queue', 'dead-letter queue', 'dead letter'], why: 'Dead-letter queue tách poison message khỏi luồng chính.' },
    { t: 'fill', q: 'Điền: pattern ghi event vào một bảng trong cùng transaction với dữ liệu rồi để relay publish sau gọi là transactional ___.', a: ['outbox'], why: 'Outbox đảm bảo at-least-once giữa DB và broker.' },
    { t: 'open', q: 'Design the asynchronous pipeline for SBOM enrichment: what delivery semantics do you choose, and how do you handle failures and ordering?', a: 'The API commits the uploaded revision and an outbox row in one transaction; a relay publishes enrichment jobs, so nothing is lost and delivery is at-least-once. Consumers are idempotent: each job carries a revision id and the result is written with an UPSERT keyed on component and revision, so a redelivered job is harmless. Transient failures from external APIs retry with exponential backoff and a per-source bulkhead; permanent failures go to a dead-letter queue after three attempts, with an alert on its depth and a replay tool. Ordering only matters per project, so jobs are partitioned by project id. I monitor consumer lag, oldest message age and a "no job processed in 15 minutes" alert to catch silent failures such as a dead publisher.', keys: ['at-least-once', 'idempotent', 'dlq', 'partition', 'lag'] }
  ]
},
{ id: 'F9', type: 'foundation', topic: 'scale', title: 'Độ tin cậy: availability, SLO/SLI, redundancy, timeout, retry, circuit breaker, graceful degradation', time: '120 phút',
  goal: 'Đặt được SLO với error budget, cấu hình timeout/retry/circuit breaker có số cụ thể cho mọi call ra ngoài, và thiết kế được alert bắt "lỗi im lặng" kiểu publisher chết hay cron lỡ tick.',
  md: `
### Vấn đề cần giải
Mọi thứ đều hỏng: đĩa, mạng, dependency, deploy. Độ tin cậy không phải "không hỏng" mà là **hỏng có kiểm soát**: biết ngay (alert), chặn lan (timeout, breaker, bulkhead), hồi phục (retry, redundancy), và đo được (SLO). Hai sự cố đau nhất của hệ thống SBOM không phải crash mà là im lặng: publisher chết nhiều ngày (#1), scheduled scan lỡ tick vì gocron in-memory và Watchtower redeploy (#9). Không có gì "lỗi" nên không có alert nào kêu.

### Cốt lõi
#### Nines, SLA/SLO/SLI, error budget
| Availability | Downtime/năm | Downtime/tháng | Ý nghĩa thực tế |
|---|---|---|---|
| 99% | 3,65 ngày | 7,3 giờ | Hệ nội bộ, batch |
| 99,9% | 8,76 giờ | 43,8 phút | SaaS B2B phổ biến |
| 99,99% | 52,6 phút | 4,4 phút | Cần multi-AZ, failover tự động, deploy không downtime |
| 99,999% | 5,3 phút | 26 giây | Hạ tầng lõi; không có chỗ cho người can thiệp tay |
- **SLI** là chỉ số đo được (tỉ lệ request không 5xx, p99 latency, freshness "last scan ≤ 24 h"). **SLO** là mục tiêu nội bộ (99,9% request thành công trong 30 ngày; p99 < 500 ms). **SLA** là cam kết hợp đồng có phạt, luôn lỏng hơn SLO.
- **Error budget** = 1 − SLO: 99,9%/tháng = 43 phút lỗi được phép. Hết budget → đóng băng feature, dồn sức reliability; còn nhiều → được deploy mạnh tay. Đây là công cụ thương lượng với PO, không phải khẩu hiệu.
- Availability **nối tiếp nhân nhau**: API 99,9% × DB 99,9% × Redis 99,9% × API ngoài 99% ≈ 98,7%. **Song song** (redundancy): 1 − (1 − 0,99)^2 = 99,99%. Mỗi dependency đồng bộ thêm vào là một lần nhân nhỏ hơn 1; muốn 99,99% mà phụ thuộc đồng bộ vào API ngoài 99% là bất khả thi → phải async hoặc fallback.

#### SPOF và redundancy
- Liệt kê single point of failure: một DB primary, một broker, một LB, một AZ, một process cron, một nơi giữ secret (sự cố #2: Lambda mất env là mất cả hệ enrichment).
| Mô hình | Failover | Chi phí | Lưu ý |
|---|---|---|---|
| Active-passive | 30 s đến vài phút (promote standby) | 2× tài nguyên dùng 1 | Phải tập failover định kỳ |
| Active-active | Tức thì, mọi node nhận traffic | Tận dụng hết | Cần stateless hoặc đồng bộ state; xung đột ghi |
| N+1 | Mất 1 node vẫn đủ năng lực | +1 node | Autoscale min 2–3 |
- Cron/scheduler là SPOF kinh điển (sự cố #9): persist lịch và [[last_run_at]] trong DB, leader election bằng lease (advisory lock hoặc Redis SET NX với TTL), hoặc đưa ra ngoài (EventBridge, k8s CronJob); job phải idempotent và biết chạy bù khi lỡ.

#### Health check
| Loại | Câu hỏi | Khi fail | Bẫy |
|---|---|---|---|
| Liveness | Process còn sống, không deadlock? | Restart | Đừng check dependency, kẻo restart vô ích khi DB chập |
| Readiness | Sẵn nhận traffic? (pool đã nối, cache warm) | Gỡ khỏi LB | Gắn chặt với DB → DB chập 10 s thì **mọi** instance rời LB cùng lúc = outage toàn phần thay vì degrade |
| Startup | App khởi động lâu? | Chờ | Không có thì liveness giết app đang khởi động |
- Deep health check ([[/health/deps]]) để dashboard xem, không dùng cho LB.

#### Timeout mọi call ra ngoài
- Không timeout = chờ vô hạn = goroutine và connection tích tụ = cascading failure. Go [[http.Client]] mặc định **không timeout**; [[database/sql]] không timeout nếu không truyền context; gRPC không deadline mặc định.
- Ba loại: connect (1–3 s), per-request/read (theo SLO), tổng ([[context.WithTimeout]]). **Deadline propagation**: client cho 2 s → service gọi DB với phần còn lại từ ctx cha; hết deadline thì không gọi tiếp.
- Đặt từ SLO xuống: p99 500 ms → mỗi dependency 100–200 ms; worker/batch tính bằng phút nhưng hữu hạn. [[statement_timeout]] là timeout phía DB (bài F5), đặt khớp với context.

#### Retry đúng cách
- Chỉ retry lỗi **tạm thời** (timeout, 503, 429, connection reset) và chỉ khi thao tác **idempotent** (GET, PUT, POST có idempotency key). Không retry 400/401/403/404/422.
- Exponential backoff + **full jitter**: [[sleep = random(0, min(cap, base × 2^attempt))]], base 100 ms, cap 10–30 s, tối đa 3 lần cho online path. Jitter phá đồng bộ: 1 000 client cùng retry sau đúng 1 s là retry storm.
- **Retry budget**: tổng retry ≤ 10% request bình thường; vượt là dependency đang hỏng, retry thêm chỉ hại. Tôn trọng [[Retry-After]].
- Retry ở **một tầng**: client 3 × gateway 3 × service 3 = 27× tải dồn lên DB đang ngắc ngoải.

#### Circuit breaker, bulkhead, fallback, load shedding
:::diagram
Client -> Svc[Service]
Svc -> CB[Circuit breaker per dependency]
CB -> Dep[Dependency API] : closed / half-open
CB -> FB[Fallback: cache cũ / default / 503 nhanh] : open
Svc -> BH[Bulkhead: pool riêng mỗi dependency]
BH -> Dep
:::
- **Circuit breaker**: Closed (đếm lỗi trong cửa sổ) → **Open** khi error rate > 50% với ≥ 20 request/10 s: trả lỗi ngay không gọi, cho dependency thở → sau 30 s **Half-open**: cho 1–vài request thăm dò; thành công → Closed, thất bại → Open. Go: [[sony/gobreaker]]. Một breaker **mỗi dependency**, không dùng chung.
- **Bulkhead**: semaphore/pool riêng cho mỗi dependency (ClearlyDefined tối đa 20 concurrent, OSV 50) → một API chậm không ăn hết goroutine/connection của cả service.
- **Fallback**: trả cache cũ, giá trị mặc định, tắt tính năng phụ (hiện danh sách component không có license thay vì 500). Graceful degradation là quyết định sản phẩm: chốt trước với PO cái gì được phép thiếu.
- **Load shedding**: quá tải (hàng chờ > N, CPU > 90%, p99 vượt ngưỡng) → trả 503 nhanh cho request mới/ít ưu tiên thay vì làm tất cả chậm; ưu tiên health check và request của khách trả tiền. Fail fast rẻ hơn fail slow.

#### Failure modes
| Failure mode | Cơ chế | Chống bằng |
|---|---|---|
| Cascading failure | Một dependency chậm → pool đầy → service chết → service gọi nó chết theo | Timeout + bulkhead + breaker |
| Thundering herd | Nhiều client cùng hành động một lúc: cache hết hạn đồng loạt, reconnect sau outage, cron cùng phút | Jitter, staggered start, singleflight |
| Retry storm | Retry nhân tải lên dependency đang hỏng, không bao giờ hồi | Backoff + jitter + budget + breaker |
| Metastable failure | Nguyên nhân đã hết nhưng tải retry/queue dồn giữ hệ thống ở trạng thái xấu | Shed load, xả queue, giảm concurrency rồi tăng dần |
- Sự cố #6 là cascading nội bộ: 238 policy eval ghim DB → 55% API 500 → FE retry → tệ hơn. Sự cố #7: một coordinate hỏng làm hỏng cả batch và hàm FetchBatch nuốt lỗi → hàng nghìn dòng failed vĩnh viễn — lỗi không được cô lập, cũng không được báo.

#### Lỗi im lặng và alert "no success in X minutes"
- Alert dựa trên lỗi (error rate, exception) **không bắt được** hệ thống "không làm gì": publisher gửi vào channel chết (#1), cron không chạy (#9), batch nuốt lỗi (#7).
- Giải: đo **thành công**, không chỉ đo lỗi. Gauge [[job_last_success_timestamp{job}]] → alert khi [[time() − last_success > 2 × chu kỳ]]; counter publish_total/consume_total → alert khi rate = 0 trong giờ có lịch; dead man's switch (job ping healthchecks.io khi xong; không ping → alert). Mỗi cron/background loop phải xuất 3 thứ: last_success, last_error, duration.
- Không nuốt lỗi: hàm batch trả lỗi theo từng item, log có context, metric failed_total theo lý do.

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| 99,9% / 99,99% mỗi tháng | 43,8 phút / 4,4 phút |
| Backoff | base 100 ms, cap 10–30 s, tối đa 3 lần, full jitter |
| Retry budget | ≤ 10% request |
| Breaker mở khi | error rate > 50%, ≥ 20 request/10 s; half-open sau 30 s |
| Connect timeout | 1–3 s |
| Health check LB | mỗi 5–10 s, fail 2–3 lần liên tiếp |
| Alert no-success | 2 × chu kỳ job |
| Nối tiếp 3 dependency 99,9% | ≈ 99,7% |

### Sai lầm hay gặp
- Nhầm SLA với SLO; hứa 99,99% cho hệ phụ thuộc đồng bộ vào API ngoài 99%.
- [[http.Client]] không timeout; retry mọi lỗi kể cả 400; retry không jitter; retry ở nhiều tầng.
- Readiness check gắn DB → outage toàn phần thay vì degrade.
- Breaker chung cho mọi dependency; không half-open nên không bao giờ đóng lại.
- Chỉ alert khi có lỗi; không heartbeat cho job nền (sự cố #1, #9); hàm batch nuốt lỗi (sự cố #7).
- Cron trong process app không leader election → chạy trùng hoặc không chạy khi redeploy.
- Không bao giờ tập failover DB/broker → lần failover đầu tiên là lúc sự cố thật.

### Nói thế nào trong phỏng vấn (EN)
- "We define SLIs first — success ratio and p99 latency — then set an SLO like 99.9% over 30 days, which gives us a 43-minute monthly error budget." — Định nghĩa SLI trước, rồi SLO 99,9%/30 ngày tương đương 43 phút budget.
- "Every outbound call has a timeout derived from the SLO, retries only on transient errors with exponential backoff and jitter, and at most three attempts." — Mọi call ra ngoài có timeout theo SLO, chỉ retry lỗi tạm với backoff + jitter, tối đa 3 lần.
- "A circuit breaker per dependency fails fast when the error rate exceeds 50%, then probes in half-open before closing again." — Breaker mỗi dependency fail nhanh khi lỗi > 50%, thăm dò ở half-open rồi mới đóng.
- "Chaining three 99.9% dependencies synchronously caps us at about 99.7%, so the optional ones become async or get a fallback." — Nối tiếp 3 dependency 99,9% chỉ còn ~99,7%, nên phần không bắt buộc chuyển async hoặc có fallback.
- "Silent failures don't raise errors, so I alert on the absence of success: no job completed in twice its schedule interval." — Lỗi im lặng không sinh lỗi, nên tôi alert khi vắng thành công.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Định nghĩa 3 SLI/SLO và đưa lên dashboard: API success ≥ 99,9%; p95 danh sách component/EOL/vuln audit ≤ 5 s (cam kết pilot); freshness "99% project có scheduled scan hoàn tất trong 24 giờ". Tính error budget tháng này từ log có sẵn.
- Audit timeout: mọi [[http.Client]] gọi ClearlyDefined/OSV/NVD/GHSA/EUVD/JVNDB phải có [[Timeout]] và context; mọi query DB truyền ctx có deadline; Lambda handler chia budget 900 s cho từng pha và dừng sớm thay vì bị kill giữa chừng.
- Breaker + bulkhead **per source**: ClearlyDefined 20 concurrent, timeout 10 s, breaker riêng; FetchBatch (sự cố #7) trả lỗi theo từng coordinate, khi cả batch fail thì tách và retry từng item, đánh dấu riêng coordinate version-range không hợp lệ thay vì failed cả lô.
- Heartbeat cho mọi job nền (OSV/NVD sync, scheduled scan, sweeper, reconcile): gauge [[job_last_success_timestamp]] + alert > 2 × chu kỳ; counter publish_total với alert rate = 0 trong 15 phút (sự cố #1, #9).
- gocron: leader election bằng [[pg_try_advisory_lock]] hoặc lease Redis TTL 60 s; persist [[last_run_at]] để chạy bù sau Watchtower redeploy; stagger các cron cách nhau vài phút (thundering herd lúc 00:00).
- Readiness của apiserver không gắn cứng DB/Redis; degrade: khi enrichment chậm, UI hiện component chưa có license thay vì lỗi.
- Postmortem blameless cho #1 và #9: timeline, vì sao không ai biết, action item có owner và deadline; đưa vào ADR "alerting cho background job".
`,
  quiz: [
    { t: 'mc', q: 'SLO 99,9% tính theo 30 ngày. Error budget mỗi tháng xấp xỉ bao nhiêu?', o: ['~4,3 phút', '~43 phút', '~7,2 giờ', '~3,6 ngày'], a: 1, why: '0,1% × 30 ngày × 24 × 60 ≈ 43 phút.' },
    { t: 'mc', q: 'API gọi đồng bộ 3 dependency, mỗi cái 99,9%. Availability tối đa của API là bao nhiêu?', o: ['99,9% vì lấy theo dependency yếu nhất', '99,99% nhờ redundancy', '~99,7% vì nhân xác suất các thành phần nối tiếp', '~99,0%'], a: 2, why: '0,999^3 ≈ 0,997; mỗi dependency đồng bộ là một lần nhân nhỏ hơn 1.' },
    { t: 'mc', q: 'Chiến lược retry nào SAI?', o: ['Retry GET sau timeout với backoff và jitter', 'Retry POST tạo đơn không có idempotency key sau timeout', 'Retry khi nhận 503 kèm Retry-After', 'Không retry khi nhận 400'], a: 1, why: 'POST không idempotent có thể đã thành công phía server; retry tạo bản ghi trùng.' },
    { t: 'mc', q: 'Circuit breaker đã chuyển sang Open. Bước tiếp theo đúng là gì?', o: ['Giữ Open cho tới khi restart service', 'Chuyển Closed ngay sau 1 giây', 'Tăng timeout gấp đôi rồi mở lại', 'Sau khoảng chờ chuyển Half-open, cho vài request thăm dò rồi quyết định'], a: 3, why: 'Half-open là cách breaker tự phát hiện dependency đã hồi mà không dồn tải lên nó.' },
    { t: 'mc', q: 'Publisher RabbitMQ chết im lặng 5 ngày không ai biết. Alert nào bắt được?', o: ['Error rate > 1%', 'CPU > 80%', 'Không có message publish/consume trong X phút (alert theo vắng thành công)', 'Disk > 90%'], a: 2, why: 'Publisher chết không sinh lỗi, CPU hay disk; chỉ đo "thành công gần nhất" mới thấy.' },
    { t: 'fill', q: 'Điền: kỹ thuật thêm độ ngẫu nhiên vào khoảng chờ giữa các lần retry để tránh nhiều client retry cùng lúc gọi là ___.', a: ['jitter', 'full jitter', 'random jitter'], why: 'Full jitter: sleep = random(0, min(cap, base × 2^attempt)).' },
    { t: 'fill', q: 'Điền: trạng thái trung gian của circuit breaker cho phép vài request thăm dò trước khi đóng lại là ___.', a: ['half-open', 'half open', 'halfopen'], why: 'Closed → Open → Half-open → Closed hoặc Open.' },
    { t: 'open', q: 'A downstream license API becomes slow. How do you keep it from taking down your enrichment service?', a: 'First, every call to it has a connect and overall timeout derived from our processing budget, so slow responses fail fast instead of piling up. Second, a bulkhead limits concurrency to that API, say 20 in-flight requests, so it cannot consume all goroutines and connections. Third, a circuit breaker dedicated to that dependency opens when the error rate passes 50% and probes in half-open before closing. Retries use exponential backoff with jitter, only on transient errors, within a retry budget. When the breaker is open we fall back: keep the component with license pending and let the sweeper retry later, so users still see their SBOM. Finally we alert on last-success age for the enrichment job so a silent stall is visible.', keys: ['timeout', 'circuit breaker', 'bulkhead', 'fallback', 'backoff'] }
  ]
},
{ id: 'F10', type: 'foundation', topic: 'scale', title: 'Khả năng mở rộng: stateless, load balancing, scale out DB, autoscaling, giới hạn', time: '120 phút',
  goal: 'Thiết kế được tầng stateless scale ngang sau load balancer với health check và draining, nêu đúng thứ tự scale DB (index → cache → replica → partition → shard), chọn metric autoscaling phù hợp, và giải thích vì sao thêm máy không cho tốc độ tuyến tính.',
  md: `
### Vấn đề cần giải
"Scale" không phải thêm máy. Thêm 10 API server trong khi DB vẫn là một primary 4 vCPU chỉ chuyển điểm nghẽn sang DB nhanh hơn (sự cố #6: bảng 9,6 triệu dòng không index, 238 policy eval, DB 100% CPU, 55% request 500). Khả năng mở rộng là **đẩy trạng thái ra khỏi tầng dễ nhân bản**, dồn nó vào tầng có chiến lược scale riêng, và biết giới hạn: Amdahl nói phần tuần tự quyết định trần, không phải số máy.

### Cốt lõi
#### Vertical vs horizontal
| | Vertical (máy to hơn) | Horizontal (nhiều máy) |
|---|---|---|
| Ưu | Không đổi code, không bài toán phân tán, đơn giản | Gần như không trần, có redundancy, rẻ theo đơn vị |
| Nhược | Trần vật lý, giá tăng phi tuyến, vẫn là SPOF, nâng cấp có downtime | Cần stateless hoặc partition, LB, discovery, vận hành phức tạp |
| Dùng cho | DB trước tiên, làm tới khi hết kinh tế | Tầng web/worker; DB chỉ khi đã hết cách khác |

:::diagram
Client[Clients] -> DNS[DNS / GeoDNS]
DNS -> LB[Load balancer L7] : health check, draining
LB -> API1[API 1]
LB -> API2[API 2]
LB -> APIn[API n]
API1 -> Redis[Redis: session, cache]
API1 -> PG[Postgres primary] : write
PG -> RR[Read replica] : async replication
API1 -> RR : read
API1 -> MQ[Queue]
MQ -> W[Workers: autoscale theo lag]
:::

#### Stateless service
- Stateless = **instance nào cũng xử lý được request nào**: không session trong RAM, không file trên đĩa local, không "nguồn sự thật" trong process, không cron độc quyền trong process (sự cố #9).
| Session ở đâu | Ưu | Nhược |
|---|---|---|
| Redis/DB session store | Revoke được ngay, kích thước tuỳ ý | Thêm 1 RTT (~0,5 ms); Redis thành dependency |
| JWT (stateless token) | Không RTT, scale tự nhiên | Không revoke trước expiry → access token ngắn 5–15 phút + refresh token lưu DB; lộ secret là lộ hết |
| Sticky session | Dễ, giữ code cũ | Mất instance là mất session; tải lệch; phá autoscale |
- Sticky session chỉ khi: WebSocket/long-lived connection cần affinity (nhưng vẫn có pub/sub Redis để node khác gửi được), hoặc legacy không sửa được. Upload → object storage (S3/MinIO) ngay; config qua env/config service; log ra stdout → collector.

#### Load balancer
| | L4 | L7 |
|---|---|---|
| Hiểu gì | TCP/UDP, IP:port | HTTP: path, host, header, cookie |
| Ưu | Rất nhanh, hàng triệu connection | Route theo nội dung, terminate TLS, retry/rewrite/rate limit, cân bằng theo **request** (tốt cho HTTP/2, gRPC) |
| Nhược | Cân bằng theo **connection**: gRPC/WebSocket sống lâu → lệch | Chậm hơn chút, tốn CPU |
| Ví dụ | AWS NLB, HAProxy tcp | AWS ALB, nginx, Envoy, Traefik |
| Thuật toán | Dùng khi | Lưu ý |
|---|---|---|
| Round robin / weighted RR | Instance giống nhau / canary, máy to nhỏ | Không biết tải thực |
| Least connections | Request dài ngắn khác nhau | Phổ biến nhất cho API |
| Latency-aware | Instance ở nhiều vùng | Cần đo liên tục |
| IP hash / consistent hashing | Cần affinity, cache locality | Thêm node chỉ ~1/N key đổi chỗ |
| Power of two choices | Nhiều LB không chia sẻ trạng thái | Chọn 2 ngẫu nhiên, lấy cái ít tải; gần tối ưu, rẻ |
- **Health check**: gỡ instance sau 2–3 lần fail liên tiếp, interval 5–10 s. **Connection draining** (deregistration delay 30–60 s) khi deploy để request đang chạy hoàn tất. App phải xử lý SIGTERM: ngừng nhận, chờ in-flight, đóng pool ([[http.Server.Shutdown]]) → zero-downtime deploy.
- Sự cố #10: FE server-side gọi API bằng hostname public từ trong Docker → hairpin NAT → ECONNREFUSED; FE image bake env localhost → 500 toàn site. Tách địa chỉ **nội bộ** (service name) và **công khai**; config lúc runtime, không bake.

#### Scale DB theo thứ tự ưu tiên
1. **Query và index** (rẻ nhất, hiệu quả nhất): EXPLAIN, index đúng, bỏ N+1, bỏ SELECT *, batch. Một index đúng (sự cố #6) rẻ hơn 10 máy.
2. **Cache** (bài F7): đưa 80–95% read ra khỏi DB.
3. **Connection pooling** (PgBouncer): nhiều instance app không đè DB bằng connection.
4. **Vertical**: RAM đủ chứa working set, shared_buffers hợp lý (pilot: 4 vCPU và shared_buffers 160 MB là quá nhỏ cho DB hàng chục GB).
5. **Read replica**: tách read; trả giá replication lag (ms–s) → **read-your-writes** sai: sau khi ghi, đọc từ primary trong vài giây hoặc theo session. Replica không giúp write.
6. **Partition** trong một DB: theo thời gian/tenant → query chạm ít partition, drop partition cũ tức thì, VACUUM nhỏ; vẫn một máy.
7. **Shard** ra nhiều DB theo key (tenant_id): scale write; trả giá không join/transaction cross-shard, rebalancing, hot shard, phức tạp ứng dụng. Làm cuối cùng (chi tiết ở B-series). SaaS multi-tenant có key shard tự nhiên; tenant rất lớn có thể có shard riêng.

#### Service discovery
- Client phải tìm được IP các instance luôn thay đổi. **Server-side** (LB hoặc DNS tên service: docker-compose, k8s Service, ALB) đơn giản. **Client-side** (lấy danh sách từ Consul/etcd/Eureka, tự cân bằng) ít hop, tốt cho gRPC, client phức tạp hơn. Service mesh (Envoy sidecar) đẩy việc này ra khỏi code.
- Bẫy: pool giữ connection tới IP cũ sau khi instance đổi → đặt [[IdleConnTimeout]]/[[ConnMaxLifetime]] ngắn hơn vòng đời instance.

#### Autoscaling
| Metric | Dùng cho | Lưu ý |
|---|---|---|
| CPU % | Web CPU-bound | Vô dụng với service I/O-bound chờ DB/API |
| RPS mỗi instance, p95 latency | Web | Cần load test để biết năng lực một instance |
| Queue depth / consumer lag | Worker | Tốt nhất cho async (KEDA); scale về 0 được |
| Lịch | Traffic theo giờ biết trước | Kết hợp với metric |
- **Cooldown/stabilization window**: scale-out 1–2 phút, scale-in 3–5 phút để tránh flapping. Scale-out bị giới hạn bởi thời gian khởi động (pull image, warm cache) → giữ headroom 30–50%. Min replicas ≥ 2 (redundancy); **max replicas** để không đè DB — autoscale API vô hạn là tự DDoS DB của mình. Scale-in phải drain. DB không autoscale theo nghĩa này (Aurora chỉ thêm replica hoặc serverless có giới hạn).

#### Giới hạn: Amdahl, USL, Little
- **Amdahl**: speedup = 1 / ((1 − p) + p / N), p là phần song song hoá được. 5% tuần tự (ghi vào một primary, lock, leader) → trần 20× dù N vô hạn; 10% → trần 10×.
- **Universal Scalability Law** (Gunther): cộng thêm contention (chờ lock/queue) và coherency (đồng bộ state giữa node) → throughput tăng rồi **giảm** khi thêm node: nhiều app instance → nhiều connection → lock contention trên DB; cache coherence. "Thêm máy làm chậm hơn" là có thật.
- **Little**: L = λ × W. 2 000 RPS × 50 ms = 100 request đang bay → pool/goroutine ≥ 100; DB chậm lên 500 ms → 1 000 request đang bay → pool đầy → queue → cascading. Latency tăng là nguyên nhân cạn tài nguyên, không phải hệ quả.
- Bottleneck **di chuyển**: sửa cái này, cái tiếp theo lộ ra; thường theo thứ tự DB (lock/CPU/IO) → external API (rate limit, latency; sự cố #7) → broker → network. Đo trước khi scale; không có số thì scale là đoán.

### Số liệu cần nhớ
| Đại lượng | Giá trị |
|---|---|
| Web Go stateless | vài nghìn đến vài chục nghìn RPS mỗi instance (request nhẹ) |
| Health check LB | mỗi 5–10 s, gỡ sau 2–3 lần fail |
| Connection draining | 30–60 s |
| Access token JWT | 5–15 phút |
| Replication lag | ms đến vài s (tăng khi primary bận) |
| Cooldown scale-out / scale-in | 1–2 phút / 3–5 phút |
| Headroom | 30–50% |
| Amdahl 5% tuần tự | trần 20× |

### Sai lầm hay gặp
- Scale tầng API trước khi nhìn vào DB (sự cố #6).
- Session trong RAM cộng autoscale → user bị logout ngẫu nhiên.
- Bake config vào image, gọi hostname public trong mạng nội bộ (sự cố #10).
- L4 LB trước gRPC → một instance ôm hết stream.
- Không graceful shutdown → mỗi deploy rớt request; Watchtower stop timeout ngắn hơn thời gian drain.
- Autoscale theo CPU cho worker I/O-bound → không bao giờ scale; không max replicas → đè DB.
- Shard sớm vì "sau này scale" → tốn một năm cho vấn đề chưa có.
- Đọc từ replica ngay sau khi ghi → "tôi vừa tạo mà không thấy".

### Nói thế nào trong phỏng vấn (EN)
- "The API tier is stateless — sessions live in Redis or a short-lived JWT — so we can add instances behind the load balancer freely." — Tầng API stateless, session ở Redis hoặc JWT ngắn hạn, nên thêm instance thoải mái.
- "Before scaling the database out, I'd fix queries and indexes, add caching and connection pooling; a single missing index was our actual bottleneck." — Trước khi scale DB ra, tôi sửa query/index, thêm cache và pooling; một index thiếu từng là bottleneck thật.
- "Read replicas trade consistency for read capacity, so writes are followed by primary reads for a few seconds." — Replica đổi consistency lấy read; sau khi ghi đọc từ primary vài giây.
- "Workers autoscale on queue depth, not CPU, with a cooldown to avoid flapping and a max to protect the database." — Worker scale theo queue depth, có cooldown và max để bảo vệ DB.
- "By Amdahl's law the serial part — the single primary — caps our speedup, which is why sharding is the last resort, not the first." — Theo Amdahl phần tuần tự chặn trần, nên shard là phương án cuối.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Kiểm tra apiserver có thật sự stateless: session/JWT lưu ở đâu, có ghi file local không, có cache "nguồn sự thật" trong RAM không; gocron hiện nằm trong worker (stateful) → tách scheduler hoặc lease (sự cố #9) trước khi chạy worker nhiều bản.
- Graceful shutdown với Watchtower: [[http.Server.Shutdown]] với timeout 30 s, worker ngừng nhận message và ack nốt việc đang làm; đặt stop timeout của Watchtower/compose ≥ thời gian drain; kiểm chứng bằng cách deploy lúc có traffic và đếm 5xx.
- Sự cố #10: FE → API qua service name nội bộ (sbom:20000) bằng env runtime; thêm test khởi động "gọi được API nội bộ" trước khi FE nhận traffic.
- Thứ tự scale DB áp lên pilot: (1) index cho bảng violation 9,6 triệu dòng và partial index pending (sự cố #6, #16); (2) cache danh sách policy/config; (3) PgBouncer; (4) RAM/shared_buffers; (5) read replica cho export/report; (6) partition bảng violation theo tenant hoặc tháng. Chưa bàn shard.
- Little's law trên số thật: RPS × p95 latency của apiserver → số request đang bay; so với [[SetMaxOpenConns]] và số goroutine; nếu latency tăng 5× thì pool có đủ không?
- Load test một instance apiserver (k6/vegeta) để biết RPS/instance → chọn metric autoscale (RPS hoặc p95) với max replicas = max_connections ÷ pool size; worker scale theo queue depth RabbitMQ.
- Viết ADR "chiến lược scale 2.x": stateless API, LB L7, thứ tự scale DB, metric autoscale, giới hạn đã biết (DB primary đơn, ClearlyDefined rate limit).
`,
  quiz: [
    { t: 'mc', q: 'DB CPU 100% trong khi đã có 10 API instance. Việc đầu tiên nên làm?', o: ['Thêm 10 API instance nữa', 'Shard DB theo tenant', 'EXPLAIN các query nặng nhất, thêm index/cache đúng chỗ', 'Chuyển sang NoSQL'], a: 2, why: 'Bottleneck ở DB; thêm API chỉ tăng tải; index/query là bước rẻ và hiệu quả nhất trước khi scale DB.' },
    { t: 'mc', q: 'Vì sao sticky session làm hỏng autoscaling?', o: ['Vì LB L7 không đọc được cookie', 'Vì cookie session quá lớn', 'Vì tốn thêm 1 RTT mỗi request', 'Vì tải dồn vào instance cũ, instance mới ít việc, và mất instance là mất session'], a: 3, why: 'Affinity trói user vào instance nên thêm/bớt instance không phân phối lại tải và làm mất trạng thái.' },
    { t: 'mc', q: 'Worker tiêu thụ queue và I/O-bound (chờ API ngoài). Metric autoscale phù hợp nhất?', o: ['CPU %', 'Queue depth / consumer lag', 'Disk I/O', 'Số instance của API'], a: 1, why: 'I/O-bound thì CPU thấp dù quá tải; độ dài hàng đợi phản ánh đúng việc tồn.' },
    { t: 'mc', q: 'Theo Amdahl, nếu 10% công việc là tuần tự thì speedup tối đa khi số máy tiến tới vô hạn là?', o: ['10×', '100×', 'Vô hạn', '2×'], a: 0, why: '1 / (1 − p) = 1 / 0,1 = 10.' },
    { t: 'mc', q: 'Sau khi ghi vào primary, user đọc ngay từ read replica và thấy dữ liệu cũ. Giải pháp hợp lý?', o: ['Tắt replica và đọc hết từ primary', 'Thêm cache Redis trước replica', 'Read-your-writes: định tuyến đọc của user vừa ghi về primary trong vài giây hoặc theo session', 'Tăng timeout của request'], a: 2, why: 'Replication lag là bản chất của async replica; chỉ cần đọc từ primary trong cửa sổ ngắn sau ghi.' },
    { t: 'fill', q: 'Điền: thuật toán LB chọn ngẫu nhiên hai server rồi lấy server ít tải hơn gọi là power of ___ choices.', a: ['two', '2', 'two choices'], why: 'Power of two choices gần tối ưu với chi phí rất thấp, không cần trạng thái toàn cục.' },
    { t: 'fill', q: 'Điền: khoảng thời gian LB giữ instance sắp gỡ để các request đang chạy hoàn tất khi deploy gọi là connection ___.', a: ['draining', 'drain'], why: 'Draining (deregistration delay) 30–60 s kết hợp graceful shutdown cho zero-downtime deploy.' },
    { t: 'open', q: 'How would you scale the SBOM API from 10 tenants to 10,000 tenants?', a: 'I would first make sure the API tier is stateless (sessions in Redis or short JWTs, uploads to object storage, scheduler moved out of the process) so it scales horizontally behind an L7 load balancer with health checks and draining. Then I would attack the database in order: fix the heaviest queries and add the missing indexes, cache tenant config and policy lists, put PgBouncer in front, and scale the instance vertically. Next, read replicas for exports and reports with read-your-writes routing, and partitioning of the largest tables by tenant or time. Workers autoscale on queue depth with a max bound by database connections. Sharding by tenant is the last step, only when write volume demands it, and I would measure RPS per instance and Little\'s law numbers before each step.', keys: ['stateless', 'index', 'cache', 'replica', 'shard'] }
  ]
}
];
