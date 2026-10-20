/* ===== Mock interview cho case bổ sung C20–C23 (M20–M23) ===== */
window.MOCKS = window.MOCKS || [];
window.MOCKS.push({
  id: 'M20', caseId: 'C20', title: 'Design an AI assistant over private documents (RAG)', level: 3,
  prompt: `"Design an AI assistant that answers questions over a company's private documents. About 200 customer organisations, 2 million document chunks in total, 5 thousand questions a day. Answers must cite their sources, cost must stay under 3000 USD a month, and users should see text appear within a second."
Thiết kế trợ lý AI trả lời câu hỏi trên tài liệu riêng của doanh nghiệp: 200 tổ chức khách hàng, tổng 2 triệu đoạn tài liệu, 5 nghìn câu hỏi mỗi ngày, bắt buộc trích nguồn, ngân sách dưới 3000 USD mỗi tháng, người dùng phải thấy chữ chạy trong 1 giây.`,
  clarify: [
    'Hỏi: Dữ liệu các tổ chức có dùng chung không? → Đáp: tuyệt đối không; trong một tổ chức còn phân quyền theo không gian làm việc.',
    'Hỏi: Tài liệu đổi thường xuyên không? → Đáp: vài trăm tài liệu sửa mỗi ngày, nối Confluence và upload tay.',
    'Hỏi: Trả lời sai thì sao? → Đáp: mất niềm tin; thà nói không tìm thấy còn hơn đoán.',
    'Hỏi: Độ trễ chấp nhận được? → Đáp: thấy chữ trong 1 giây, trả lời xong trong 10 giây.',
    'Hỏi: Có cần trợ lý thực hiện hành động không? → Đáp: giai đoạn này chỉ đọc.',
    'Hỏi: Có ràng buộc dữ liệu theo khu vực không? → Đáp: hai khách EU yêu cầu dữ liệu ở lại EU.',
    'Hỏi: Đo chất lượng thế nào? → Đáp: đó là phần chúng tôi muốn nghe bạn đề xuất.'
  ],
  phases: {
    req: { checks: ['Hỏi về cách ly tenant và phân quyền trước khi vẽ', 'Chốt yêu cầu trích nguồn và hành vi khi không tìm thấy', 'Chốt ngân sách và độ trễ thành hai con số riêng (TTFT và tổng)', 'Nói rõ ngoài phạm vi: huấn luyện mô hình, trợ lý ghi dữ liệu'],
      hint: `Đây là đề mà ràng buộc chính là tiền và niềm tin, không phải QPS.
Hỏi ngay: dữ liệu có dùng chung không, trả lời sai hậu quả thế nào, ngân sách bao nhiêu.
Chốt ba nhóm và nhớ tách TTFT khỏi tổng thời gian trả lời.` },
    est: { checks: ['2 triệu vector x 1536 chiều x 4 byte = 12 GB, kết luận pgvector đủ', 'QPS chỉ khoảng 0,6 lúc đỉnh, nói rõ QPS không phải nút thắt', 'Token mỗi câu khoảng 4600 vào và 400 ra', 'Chi phí tháng khoảng 2200 USD và nói chi phí tỉ lệ với số chunk'],
      hint: `1536 x 4 = 6 KB mỗi vector. 2 triệu x 6 KB = 12 GB; cộng đồ thị HNSW khoảng 18 GB.
5000 câu / 86400 = 0,06 QPS trung bình, đỉnh x10 = 0,6 QPS.
6 chunk x 700 token = 4200 token ngữ cảnh. Kết luận phải nói: tiền và chất lượng là nút thắt.` },
    hld: { checks: ['Vẽ tách hai đường: ingest offline và hỏi đáp online', 'Đường ingest có chunk, metadata quyền, embedding batch, trạng thái retry', 'Đường hỏi có kiểm quyền, cache, truy hồi hybrid, re-rank, LLM, SSE', 'Nêu bảng dữ liệu có cột embedding_version'],
      hint: `Vẽ hai đường rõ ràng, nói đường ingest hỏng thì câu trả lời cũ đi chứ hệ không chết.
Đường hỏi: auth rồi cache rồi retriever hybrid (vector + full-text, lọc org trong WHERE) rồi RRF rồi re-rank rồi prompt rồi LLM rồi SSE.
Nhớ nói chunk 500-800 token chồng lấn 15 phần trăm và metadata org_id, workspace_id, acl.` },
    deep: { checks: ['Cách ly tenant ở ba lớp: truy vấn, khoá cache, kiểm quyền ở API', 'Hybrid search và lý do (mã định danh chính xác)', 'Ngưỡng từ chối khi điểm re-rank thấp', 'Eval set có nhãn, recall@k tách khỏi đo phần sinh, chạy trong CI', 'Kiểm soát chi phí: cache hai tầng, giảm số chunk, hạn mức token theo org'],
      hint: `Điểm nóng 1: đa tenant. Lọc trong truy vấn, khoá cache có org và quyền, quyền kiểm ở API không nhờ prompt.
Điểm nóng 2: chất lượng. Hybrid cộng RRF cộng re-rank, và ngưỡng để không trả lời.
Điểm nóng 3: tiền. Số chunk nhân số câu là công thức chi phí; cache ngữ nghĩa ngưỡng 0,96 TTL ngắn.
Điểm nóng 4: đo. Eval set 150 câu, recall@5 và tính trung thực, chặn merge khi tụt.` },
    wrap: { checks: ['Nêu trade-off pgvector vs vector DB riêng kèm ngưỡng đổi ý', 'Có đường lui khi nhà cung cấp LLM hỏng', 'Nêu metric vận hành: p95 TTFT, chi phí mỗi phiên, tỉ lệ từ chối, trích dẫn hợp lệ'],
      hint: `Tóm tắt: RAG chứ không fine-tune; pgvector vì 12 GB; hybrid vì mã định danh; ngưỡng từ chối vì niềm tin; eval vì không đo thì không sửa được.
Nói ngưỡng đổi ý: quá 10 triệu vector hoặc cần scale index độc lập thì mới tách hệ riêng.` }
  },
  followups: [
    'A customer reports the assistant answered using another customer document. How do you investigate?',
    'Why not fine-tune a model on each customer corpus instead?',
    'How do you handle a document that is updated every hour?',
    'The provider raises latency to 4 seconds for first token. What changes?',
    'How would you cut cost by 40 percent without hurting quality?',
    'How do you know a new prompt is better than the old one?',
    'A user asks something the documents do not cover. What should happen?',
    'How does the design change for the two EU customers that require data residency?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tách hai đường ngay từ sơ đồ đầu; bật ra 6 KB mỗi vector và 12 GB; nói QPS không phải vấn đề mà tiền và truy hồi mới là; lọc tenant trong truy vấn và trong khoá cache; hybrid cộng re-rank; có ngưỡng từ chối; có eval set chạy CI.
**Bẫy thường gặp**:
- Nói tên vector DB trước khi tính dung lượng.
- Quên BM25, chỉ dùng vector, rồi không giải thích được vì sao trượt mã CVE hoặc mã hợp đồng.
- Coi prompt là nơi thực thi phân quyền.
- Không nhắc tiền dù đề cho sẵn ngân sách.
- Nói sẽ fine-tune để cập nhật tài liệu.
- Không có cách đo, chỉ nói sẽ thử vài câu xem sao.
**Dấu hiệu senior**: nói nút thắt là truy hồi chứ không phải mô hình; version hoá embedding và blue-green cho index; coi nhà cung cấp LLM là dependency cấp 1 có timeout, circuit breaker, pin version, đường lui không-AI; đề xuất ngưỡng từ chối và đo tỉ lệ trích dẫn hợp lệ.
**Thời gian**: dễ sa đà vào bàn mô hình. Nếu quá 8 phút mà chưa vẽ xong hai đường thì bạn đang lạc đề.`
});
window.MOCKS.push({
  id: 'M21', caseId: 'C21', title: 'Design a distributed cache', level: 2,
  prompt: `"Design a distributed in-memory cache like Memcached or Redis cluster. It should serve 1 million reads per second with p99 under 5 milliseconds, hold about 1 terabyte of data, and survive node failures without taking down the database behind it."
Thiết kế distributed cache trong bộ nhớ kiểu Memcached hoặc Redis cluster: 1 triệu lượt đọc mỗi giây, p99 dưới 5 ms, chứa khoảng 1 TB, chịu được node chết mà không kéo sập database phía sau.`,
  clarify: [
    'Hỏi: Mất dữ liệu cache có chấp nhận được không? → Đáp: có, nhưng mất toàn bộ cùng lúc thì DB sập.',
    'Hỏi: Giá trị lớn cỡ nào? → Đáp: phần lớn dưới 10 KB, một số tới 1 MB.',
    'Hỏi: Cần thao tác gì? → Đáp: get, set có TTL, delete, incr; không cần transaction.',
    'Hỏi: Có cần bền vững không? → Đáp: không bắt buộc, nhưng restart mà trống rỗng là vấn đề vận hành.',
    'Hỏi: Nhiều dịch vụ dùng chung không? → Đáp: có, cần tránh một dịch vụ chiếm hết bộ nhớ.',
    'Hỏi: Nhất quán với nguồn dữ liệu? → Đáp: eventual, chấp nhận cũ trong khoảng TTL.',
    'Hỏi: Có hot key không? → Đáp: có, một số khoá chiếm phần lớn lưu lượng.'
  ],
  phases: {
    req: { checks: ['Chốt cache là dữ liệu phái sinh, mất được nhưng không mất đồng loạt', 'Chốt tập lệnh tối thiểu và kích thước giá trị', 'Chốt p99 5 ms và 1 triệu đọc mỗi giây', 'Nêu ngoài phạm vi: truy vấn phức tạp, transaction, bền vững tuyệt đối'],
      hint: `Câu quan trọng nhất ở pha này: hậu quả của mất một node khác hẳn hậu quả của mất cả cụm.
Hỏi kích thước giá trị vì nó quyết định băng thông và slab.
Hỏi hot key sớm, vì nó định hình phần đào sâu.` },
    est: { checks: ['1 TB chia 48 GB mỗi node khoảng 21 shard, nhân 2 replica khoảng 42 node', '1 triệu chia 21 khoảng 48k op/s mỗi node, nằm trong khả năng', 'Băng thông 1 triệu x 2 KB = 2 GB/s toàn hệ, 100 MB/s mỗi node', 'Hit rate 95 phần trăm nghĩa là 50k request/s vẫn xuống DB'],
      hint: `Tính số node từ RAM trước, rồi mới tính QPS mỗi node và băng thông.
Con số đáng nói nhất: hit rate 95 xuống 90 là tải DB tăng gấp đôi.
Nhắc NIC: 100 MB/s mỗi node không phải chuyện nhỏ.` },
    hld: { checks: ['Chọn client-side routing và giải thích vì sao (thêm chặng là thêm độ trễ)', 'Consistent hashing với virtual node, nêu 150-200 vnode', 'Có config service hoặc cluster bus phát topology kèm epoch', 'Có replica và luồng khi miss đi xuống DB'],
      hint: `Vẽ: app cộng client lib rồi ring rồi các node; cluster bus phát topology; replica bất đồng bộ.
Nói rõ vì sao không dùng hash mod N: đổi N là cache lạnh toàn hệ.
So sánh ba cách định tuyến trong một bảng ngắn rồi chọn.` },
    deep: { checks: ['Eviction LRU gần đúng bằng lấy mẫu, LFU khi có scan, slab của Memcached', 'Hot key: L1 trong process, nhân bản khoá, đọc replica, phát hiện bằng count-min sketch', 'Stampede: single-flight, làm mới sớm theo xác suất, TTL có jitter', 'Failover có epoch và fencing, chấp nhận mất khoá nhưng không split-brain', 'Cold start: rolling restart, warm-up, rate limit phía DB'],
      hint: `Điểm nóng 1: hot key. Nêu ít nhất hai cách và nói vì sao thêm node không giúp.
Điểm nóng 2: stampede và cold start, đây là hai nguyên nhân phổ biến nhất khiến DB sập vì cache.
Điểm nóng 3: nhất quán cache và DB. Xoá chứ không ghi đè, và thừa nhận vẫn còn cửa sổ đua.` },
    wrap: { checks: ['So sánh Memcached và Redis theo nhu cầu thực tế', 'Nêu kiến trúc hai tầng L1 trong process và L2 phân tán', 'Nêu metric: hit rate theo namespace, evict/s, p99 theo node, bộ nhớ'],
      hint: `Tóm tắt: consistent hashing vì rebalancing; client-side vì độ trễ; L1 cho hot key; jitter và single-flight cho stampede; epoch cho failover.
Nói ngưỡng đổi ý: nếu cần đảm bảo không mất dữ liệu thì bạn đang xây database chứ không phải cache.` }
  },
  followups: [
    'The whole cluster just restarted and the database is at 100 percent CPU. What do you do in the next ten minutes?',
    'One key takes 40 percent of all traffic. Adding nodes does not help. Why, and what do you do?',
    'How do you add ten nodes to the cluster without a latency spike?',
    'A client has a stale topology table and keeps hitting the wrong node. What happens?',
    'Why delete the key on write instead of updating it?',
    'How do you stop one team from evicting another team data?',
    'Memcached or Redis for this, and why?',
    'How would you detect a hot key automatically?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tính số node từ RAM trong 1 phút; giải thích consistent hashing bằng một câu đúng; chọn client-side routing có lý do; xử lý hot key bằng nhiều hơn một cách; nói stampede và cold start trước khi bị hỏi; nhất quán cache và DB mô tả đúng là đánh đổi chứ không hứa suông.
**Bẫy thường gặp**:
- Dùng hash mod N rồi lúng túng khi bị hỏi thêm node.
- Quên băng thông mạng dù 1 triệu x 2 KB là 2 GB/s.
- Nói cache đảm bảo nhất quán.
- Thiết kế failover tự động mà không có epoch, dẫn tới split-brain.
- Đặt TTL cố định cho mọi khoá, không jitter.
- Bỏ qua đa tenant nên một dịch vụ ăn hết bộ nhớ.
**Dấu hiệu senior**: nhắc slab allocation và hệ quả evict dù còn bộ nhớ; đề xuất kiến trúc hai tầng L1 và L2; biết LRU trong thực tế là gần đúng bằng lấy mẫu; nói rolling restart và warm-up như một yêu cầu vận hành; đặt alert trên hit rate giảm đột ngột.
**Thời gian**: đề này dễ bị đào sâu vô tận vào eviction. Giữ eviction trong 3 phút và dành thời gian cho hot key, stampede, failover.`
});
window.MOCKS.push({
  id: 'M22', caseId: 'C22', title: 'Design a trending / top-K system', level: 3,
  prompt: `"Design a system that shows the top 100 trending search terms for the last hour, the last day and the last week, over a stream of 500 thousand searches per second, split by about 50 countries. The list should update within a minute and the board is public, so people will try to game it."
Thiết kế hệ hiển thị 100 từ khoá thịnh hành nhất trong 1 giờ, 1 ngày và 7 ngày, trên luồng 500 nghìn lượt tìm kiếm mỗi giây, chia theo khoảng 50 quốc gia, cập nhật trong 1 phút; bảng công khai nên sẽ bị cố tình đẩy.`,
  clarify: [
    'Hỏi: Top-K có cần chính xác tuyệt đối không? → Đáp: không, nhưng top 10 phải đúng.',
    'Hỏi: Bao nhiêu từ khoá riêng biệt mỗi ngày? → Đáp: khoảng 1 tỉ, phần lớn chỉ xuất hiện một lần.',
    'Hỏi: Có cần xem lại top của ngày trong quá khứ không? → Đáp: có.',
    'Hỏi: Sự kiện có đến muộn không? → Đáp: có, mobile offline gửi muộn tới vài giờ.',
    'Hỏi: Trending nghĩa là nhiều nhất hay đang tăng? → Đáp: câu hỏi hay, chúng tôi muốn đang tăng.',
    'Hỏi: Chống gian lận tới mức nào? → Đáp: tối thiểu phải vô hiệu hoá bot bấm lặp.',
    'Hỏi: Ngân sách hạ tầng? → Đáp: hợp lý, đừng dựng cụm trăm node cho việc này.'
  ],
  phases: {
    req: { checks: ['Hỏi được mức chính xác chấp nhận được', 'Hỏi số lượng từ khoá riêng biệt (quyết định toàn bộ thiết kế)', 'Phân biệt trending và most-searched ngay ở pha làm rõ', 'Chốt ngoài phạm vi: cá nhân hoá, autocomplete'],
      hint: `Hai câu hỏi đáng giá nhất: cần chính xác tuyệt đối không, và bao nhiêu từ khoá riêng biệt.
Hỏi luôn trending nghĩa là gì; nếu người phỏng vấn nói đang tăng thì bạn đã có nửa phần đào sâu.
Hỏi sự kiện đến muộn để sau này biện minh cho lớp batch.` },
    est: { checks: ['500k/s = 43 tỉ sự kiện mỗi ngày, 50 MB/s thô', 'Đếm chính xác 1 tỉ term cần khoảng 90 GB mỗi cửa sổ mỗi phân vùng', 'Count-min sketch 4 x 2^20 x 4 byte = 16 MB', 'Nhân 50 phân vùng nhân 3 cửa sổ vẫn chỉ vài GB'],
      hint: `Đây là bài mà ước lượng chính là lời giải: đặt 90 GB cạnh 16 MB.
Tính luôn băng thông 500k x 100 byte = 50 MB/s.
Kết luận phải nói thành lời: đếm chính xác trong RAM là lựa chọn sai ở quy mô này.` },
    hld: { checks: ['Kafka partition theo hash(term) để cộng cục bộ không cần phối hợp', 'Lớp nhanh: stream aggregator giữ sketch và heap, ghi Redis', 'Lớp chính xác: batch hằng giờ trên dữ liệu thô, phục vụ lịch sử và sự kiện muộn', 'API đọc Redis cho nóng và kho số liệu cho lịch sử'],
      hint: `Vẽ lambda: ingest rồi Kafka rồi aggregator (sketch và heap) rồi Redis; song song Kafka rồi object storage rồi batch rồi kho số liệu.
Nói vì sao partition theo hash(term): mọi sự kiện cùng term về một chỗ nên cộng cục bộ.
Nhắc sketch cộng được nên hợp nhất giữa node là phép cộng từng ô.` },
    deep: { checks: ['Mô tả count-min sketch đúng: lấy min, chỉ ước lượng thừa, sai số theo tổng lưu lượng', 'Cửa sổ bằng bucket: 60 sketch phút cộng lại thành giờ', 'Trending là độ lệch so với đường cơ sở 7 ngày, có ngưỡng tối thiểu', 'Chống gian lận bằng HyperLogLog đếm người dùng riêng biệt', 'Checkpoint state để aggregator chết không mất cửa sổ'],
      hint: `Điểm nóng 1: vì sao sketch đủ tốt. Nói rõ sai số lớn với mục hiếm nhưng ta chỉ cần mục nóng.
Điểm nóng 2: cửa sổ. Đừng trượt chính xác, hãy dùng bucket cộng được.
Điểm nóng 3: trending khác top count. Đây là chỗ ăn điểm rõ nhất.
Điểm nóng 4: bot. Đếm distinct user bằng HLL thay vì đếm lượt.` },
    wrap: { checks: ['Nêu trade-off lambda vs kappa và lý do chọn', 'Nêu CMS vs Space-Saving và tiêu chí chọn', 'Nêu cách publish kết quả: ghi bản mới rồi đổi con trỏ, CDN cache 30 giây'],
      hint: `Tóm tắt: xấp xỉ cho nhanh, chính xác cho lịch sử; bucket cho cửa sổ; z-score cho trending; HLL cho chống bot.
Nói điều kiện đổi quyết định: nếu bỏ yêu cầu xem lịch sử thì kappa gọn hơn.` }
  },
  followups: [
    'An aggregator dies mid-window. What happens to the board?',
    'Facebook is always number one but it is not trending. Fix the ranking.',
    'A group coordinates ten thousand accounts to push a term. What stops them?',
    'Events arrive three hours late from offline mobile clients. Where do they get counted?',
    'How accurate is your top 100 really, and how would you measure that?',
    'Can you do this with exact counts if the product insists? What would it cost?',
    'How do you support a new window, say last 5 minutes?',
    'The batch layer and the stream layer disagree. Which one wins and why?'
  ],
  rubric_notes: `**Câu trả lời mạnh**: tính chi phí đếm chính xác rồi bác bỏ bằng số; mô tả count-min sketch chính xác về mặt toán (min, chỉ thừa); dựng cửa sổ bằng bucket cộng được; tách trending khỏi top count bằng đường cơ sở; có lớp batch cho chính xác và sự kiện muộn; có checkpoint cho state.
**Bẫy thường gặp**:
- Đề xuất Redis INCR cho mỗi term mà không tính 1 tỉ khoá.
- Nói sketch mà không biết vì sao lấy min.
- Dùng cửa sổ trượt chính xác rồi vỡ bộ nhớ.
- Bỏ qua chống gian lận dù đề nói bảng công khai.
- Không nói gì về sự kiện đến muộn.
- Quên hợp nhất sketch giữa các node.
**Dấu hiệu senior**: phân biệt CMS và Space-Saving theo nhu cầu; đề xuất đếm distinct user bằng HLL như biện pháp chống bot gần như miễn phí; nói at-least-once là đủ cho top-K và giải thích vì sao; publish bằng cách đổi con trỏ thay vì sửa tại chỗ.
**Thời gian**: phần ước lượng ở đề này quan trọng hơn bình thường, đừng rút ngắn nó; nếu chưa bác bỏ được phương án đếm chính xác bằng số thì phần còn lại mất nền.`
});
window.MOCKS.push({
  id: 'M23', caseId: 'C23', title: 'Design a digital wallet with a ledger', level: 3,
  prompt: `"Design a digital wallet. Users top up from a bank card, transfer money to another user instantly, pay merchants and withdraw. Ten million users, 5 thousand transactions per second at peak. Money must never be lost or created, and every balance must be auditable at any point in time."
Thiết kế ví điện tử: nạp tiền từ thẻ, chuyển tiền tức thì cho người dùng khác, thanh toán merchant, rút tiền. 10 triệu người dùng, đỉnh 5 nghìn giao dịch mỗi giây. Tiền không được mất cũng không được tự sinh ra, và số dư phải kiểm toán được tại bất kỳ thời điểm nào.`,
  clarify: [
    'Hỏi: Chuyển tiền trong hệ có cần nguyên tử và tức thì không? → Đáp: có, dưới 1 giây.',
    'Hỏi: Nạp và rút qua ngân hàng mất bao lâu? → Đáp: bất đồng bộ, vài giây tới vài ngày, có webhook, có thể thất bại sau khi đã nhận.',
    'Hỏi: Cho phép số dư âm không? → Đáp: không, trừ tài khoản hệ thống.',
    'Hỏi: Yêu cầu kiểm toán cụ thể là gì? → Đáp: tái dựng được số dư tại bất kỳ thời điểm nào và giải thích được từng đồng.',
    'Hỏi: Có hoàn tiền và tranh chấp không? → Đáp: có, hoàn một phần cũng có.',
    'Hỏi: Có ví merchant lớn không? → Đáp: có, hàng nghìn giao dịch mỗi giây vào một ví.',
    'Hỏi: Một hay nhiều loại tiền tệ? → Đáp: bắt đầu một, đừng chặn đường đa tiền tệ.'
  ],
  phases: {
    req: { checks: ['Chốt tính đúng là ràng buộc số một, trên cả độ trễ và sẵn sàng', 'Hỏi kiểm toán nghĩa là gì cụ thể', 'Hỏi về hoàn tiền và chargeback vì nó quyết định mô hình dữ liệu', 'Nêu ngoài phạm vi: KYC, chống rửa tiền, đa tiền tệ giai đoạn một'],
      hint: `Với tiền thì thứ tự ưu tiên phải nói rõ: đúng trước, rồi mới tới nhanh và sẵn sàng.
Câu hỏi đáng giá nhất: kiểm toán nghĩa là gì, vì câu trả lời dẫn thẳng tới sổ cái chỉ-thêm.
Hỏi hot account sớm để dành chỗ cho phần đào sâu.` },
    est: { checks: ['5k giao dịch mỗi giây nhân 2 entry là khoảng 15k dòng ghi mỗi giây lúc đỉnh', '86 triệu entry mỗi ngày, khoảng 13 GB mỗi ngày và 4,7 TB mỗi năm', 'Đọc nhiều hơn ghi khoảng 10:1', 'Kết luận: nằm trong tầm một Postgres tune tốt, đây không phải bài về quy mô'],
      hint: `Tính số entry trước số byte: mỗi giao dịch ít nhất 2 dòng.
Kết luận quan trọng nhất của pha này: 15k dòng mỗi giây chưa cần shard.
Nói rõ nếu vội đi shard là đang trả lời sai câu hỏi.` },
    hld: { checks: ['Nêu bút toán kép và bất biến tổng entries bằng 0 ngay trong phần thiết kế', 'Bảng entries chỉ-thêm là nguồn sự thật, balances là dữ liệu phái sinh', 'Có bảng idempotency_keys với ràng buộc duy nhất', 'Có outbox trong cùng transaction cho thông báo và báo cáo'],
      hint: `Câu chốt nói sớm: số dư là dữ liệu phái sinh, nguồn sự thật là sổ bút toán chỉ-thêm.
Vẽ bảng: accounts, transactions, entries, balances, idempotency_keys.
Nêu luôn bất biến tổng bằng 0 vì đó là thứ khiến thiết kế này kiểm chứng được.` },
    deep: { checks: ['Chuyển tiền trong một transaction, khoá hai tài khoản theo thứ tự account_id cố định', 'Idempotency bằng unique constraint, trả lại kết quả cũ chứ không trả rỗng', 'Nạp và rút là saga với tài khoản clearing và trạng thái rõ ràng', 'Sửa sai bằng bút toán ngược, không bao giờ UPDATE hay DELETE entry', 'Hot account: chia nhỏ số dư hoặc cập nhật balances bất đồng bộ', 'Đối soát ba mức, chạy hằng ngày và có alert'],
      hint: `Điểm nóng 1: viết ra pseudo-SQL của chuyển tiền, nhớ ORDER BY account_id FOR UPDATE.
Điểm nóng 2: idempotency đúng cách, nêu cả trường hợp đang chạy thì trả 409.
Điểm nóng 3: tiền trên đường từ ngân hàng phải nằm ở tài khoản clearing.
Điểm nóng 4: hot account merchant, nêu balance sharding.
Điểm nóng 5: đối soát, đây là thứ phân biệt hệ thật với hệ trong slide.` },
    wrap: { checks: ['Nêu trade-off vật chất hoá số dư vs tính on-the-fly', 'Nói rõ chọn nhất quán hơn sẵn sàng và vì sao', 'Nêu khi nào mới shard và hệ quả mất tính nguyên tử của chuyển tiền', 'Nhắc kiểu dữ liệu tiền là số nguyên hoặc NUMERIC, không dùng float'],
      hint: `Tóm tắt: sổ cái kép, số dư phái sinh, idempotency bằng ràng buộc, bút toán ngược, clearing, đối soát.
Nói ngưỡng: khi vượt khả năng một node thì shard theo account_id và chuyển tiền xuyên shard thành saga qua clearing.
Đừng quên câu ngắn ăn điểm nhanh: tiền là số nguyên đơn vị nhỏ nhất.` }
  },
  followups: [
    'The daily reconciliation reports the global sum is off by 1.2 million. What now?',
    'Two users transfer to each other at the same time and you see deadlocks. Why?',
    'A client retries a transfer with the same idempotency key. What exactly do you return?',
    'A top-up succeeded, then the bank reverses it three days later. What happens in the ledger?',
    'One merchant wallet receives 2000 transactions per second. How do you avoid lock contention?',
    'How do you show a balance fast without summing millions of rows?',
    'When would you shard, and what breaks when you do?',
    'A bug wrote a wrong amount yesterday. Walk me through fixing it.'
  ],
  rubric_notes: `**Câu trả lời mạnh**: nói bút toán kép và bất biến tổng bằng 0 trong 2 phút đầu của phần thiết kế; số dư là dữ liệu phái sinh có thể dựng lại; idempotency bằng unique constraint và trả lại kết quả cũ; khoá theo thứ tự cố định; saga có tài khoản clearing; sửa sai bằng bút toán ngược; đối soát hằng ngày có alert; tiền là số nguyên.
**Bẫy thường gặp**:
- Lưu số dư như một cột và UPDATE, không có bảng entries.
- Dùng float cho tiền.
- Idempotency bằng kiểm tra tồn tại rồi ghi (có cửa sổ đua).
- Xoá hoặc sửa bút toán khi có lỗi.
- Quên tài khoản clearing nên tiền biến mất giữa hai hệ thống.
- Vội sharding khi 15k dòng mỗi giây chưa cần, rồi tự phá tính nguyên tử.
- Không có đối soát, nên chỉ biết sai khi khách kêu.
**Dấu hiệu senior**: chủ động nêu bất biến kiểm tra được và đặt alert lên nó; nói deadlock do thứ tự khoá trước khi bị hỏi; xử lý hot account bằng balance sharding và nêu hệ quả cho người đọc số dư; phân biệt số dư khả dụng và số dư sổ sách khi có tiền đang giữ; nhắc quy tắc làm tròn phải ghi phần dư vào tài khoản chênh lệch.
**Thời gian**: nếu hết 20 phút mà chưa nói tới entries thì bài đã hỏng; mô hình dữ liệu phải xuất hiện rất sớm.`
});
