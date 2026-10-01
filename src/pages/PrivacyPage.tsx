import React from 'react';
import { Language } from '../types';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

interface PrivacyPageProps {
  language: Language;
  onBackToStore: () => void;
}

interface PrivacySection {
  heading: string;
  paragraphs: string[];
}

interface PrivacyContent {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PrivacySection[];
}

// Grounded in the real fields this store actually stores per user (see the
// User/DepositTransaction/Order interfaces in src/types.ts) rather than
// generic boilerplate — password hashing, API key handling, and the
// blockchain-is-public-by-nature note all reflect the real implementation in
// server.ts, not assumptions. Kept local to this page for the same reason as
// TermsPage.tsx: long-form prose specific to one page, not a reusable string.
const PRIVACY_CONTENT: Record<Language, PrivacyContent> = {
  vn: {
    title: 'Chính sách bảo mật',
    lastUpdated: 'Cập nhật lần cuối: 17/09/2026',
    intro:
      'Chính sách này giải thích XCheap.top thu thập, sử dụng và bảo vệ thông tin tài khoản của bạn như thế nào. Vui lòng đọc kỹ để hiểu quyền và trách nhiệm của bạn khi sử dụng dịch vụ.',
    sections: [
      {
        heading: '1. Thông tin chúng tôi thu thập',
        paragraphs: [
          'Thông tin tài khoản: tên đăng nhập, email, mật khẩu (được băm/mã hóa một chiều, không lưu ở dạng văn bản gốc), số điện thoại và Telegram nếu bạn cung cấp, vai trò tài khoản (Người dùng/CTV/Admin) và số dư.',
          'Ví nạp tiền: mỗi tài khoản được cấp riêng một địa chỉ ví nạp trên các mạng crypto hỗ trợ (BSC, Polygon, TRC, Base).',
          'Lịch sử giao dịch: đơn hàng đã mua, giao dịch nạp tiền (bao gồm mã giao dịch/hash trên blockchain), yêu cầu rút tiền.',
          'Nội dung bạn tự nguyện cung cấp: đánh giá sản phẩm (hiển thị công khai kèm tên tài khoản).',
        ],
      },
      {
        heading: '2. Mục đích sử dụng thông tin',
        paragraphs: [
          'Thông tin được dùng để: vận hành tài khoản của bạn, xử lý và giao hàng tự động cho đơn hàng, xác nhận giao dịch nạp tiền qua blockchain, tính chiết khấu/ưu đãi VIP, xử lý yêu cầu bảo hành và hỗ trợ khách hàng, cùng các biện pháp phòng chống gian lận.',
        ],
      },
      {
        heading: '3. Bảo mật mật khẩu & khóa API',
        paragraphs: [
          'Mật khẩu tài khoản được băm (hash) trước khi lưu trữ và không thể khôi phục ngược lại thành văn bản gốc — kể cả quản trị viên cũng không thể xem được mật khẩu thật của bạn.',
          'XCheap.top không bao giờ chủ động yêu cầu bạn cung cấp mật khẩu qua Telegram, email hay bất kỳ kênh nào ngoài trang đăng nhập chính thức trên website.',
          'API key (nếu bạn tạo để gọi API) cho phép thực hiện hành động thay bạn — hãy giữ bí mật tuyệt đối. Bạn có thể tạo lại API key mới (vô hiệu hóa key cũ ngay lập tức) bất cứ lúc nào trong trang API Docs.',
        ],
      },
      {
        heading: '4. Giao dịch blockchain & tính công khai',
        paragraphs: [
          'Nạp tiền được thực hiện qua các mạng blockchain công khai (BSC, Polygon, TRC, Base). Theo đúng bản chất của công nghệ blockchain, mã giao dịch (txHash) và địa chỉ ví là dữ liệu công khai trên chuỗi mà bất kỳ ai cũng có thể tra cứu qua block explorer — không riêng gì XCheap.top, và đây không phải là thông tin do XCheap.top làm lộ.',
        ],
      },
      {
        heading: '5. Chia sẻ thông tin & quyền truy cập nội bộ',
        paragraphs: [
          'XCheap.top không bán thông tin cá nhân của bạn cho bên thứ ba.',
          'Nội bộ, chỉ đội ngũ vận hành XCheap.top (CTV/Admin phụ trách đơn hàng) mới có quyền truy cập dữ liệu tài khoản khi cần thiết để xử lý đơn hàng, yêu cầu bảo hành hoặc hỗ trợ.',
          'Thông tin chỉ được chia sẻ ra ngoài khi: bạn chủ động liên hệ hỗ trợ qua Telegram (nội dung trao đổi nằm trong ứng dụng Telegram của bạn), hoặc khi có yêu cầu hợp pháp từ cơ quan chức năng.',
        ],
      },
      {
        heading: '6. Cookie & lưu trữ trên trình duyệt',
        paragraphs: [
          'XCheap.top dùng cookie phiên đăng nhập để giữ bạn ở trạng thái đã đăng nhập, và bộ nhớ cục bộ (localStorage) của trình duyệt để ghi nhớ tùy chọn giao diện (sáng/tối) — dữ liệu này chỉ tồn tại trên trình duyệt của bạn, không được gửi lên máy chủ ngoài mục đích trên.',
        ],
      },
      {
        heading: '7. Thời gian lưu trữ dữ liệu',
        paragraphs: [
          'Dữ liệu tài khoản và lịch sử giao dịch được lưu trữ trong suốt thời gian bạn còn sử dụng dịch vụ, phục vụ việc tra cứu lịch sử mua hàng, xử lý bảo hành và các nghĩa vụ lưu trữ hồ sơ giao dịch theo quy định pháp luật liên quan.',
        ],
      },
      {
        heading: '8. Quyền của bạn đối với dữ liệu cá nhân',
        paragraphs: [
          'Theo quy định pháp luật hiện hành về bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP), bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc yêu cầu xóa thông tin tài khoản của mình — trừ dữ liệu bắt buộc phải lưu giữ theo quy định pháp luật (ví dụ hồ sơ giao dịch tài chính).',
          'Để thực hiện các quyền này, vui lòng liên hệ hỗ trợ qua Telegram tại mục "Hỗ trợ" trong menu tài khoản.',
        ],
      },
      {
        heading: '9. Thay đổi chính sách',
        paragraphs: [
          'Chính sách này có thể được cập nhật theo thời gian để phản ánh đúng cách dữ liệu thực sự được thu thập và xử lý. Ngày cập nhật gần nhất luôn hiển thị ở đầu trang.',
        ],
      },
      {
        heading: '10. Liên hệ',
        paragraphs: [
          'Mọi thắc mắc về chính sách bảo mật, vui lòng liên hệ hỗ trợ qua Telegram tại mục "Hỗ trợ" trong menu tài khoản.',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: Sep 17, 2026',
    intro:
      'This policy explains how XCheap.top collects, uses, and protects your account information. Please read it carefully to understand your rights and responsibilities when using the service.',
    sections: [
      {
        heading: '1. Information we collect',
        paragraphs: [
          'Account information: username, email, password (one-way hashed, never stored in plain text), phone number and Telegram handle if you provide them, account role (User/CTV/Admin), and balance.',
          'Deposit wallet: each account is assigned its own deposit address on every supported crypto network (BSC, Polygon, TRC, Base).',
          'Transaction history: purchased orders, deposit transactions (including the on-chain transaction hash), and withdrawal requests.',
          'Content you voluntarily provide: product reviews (shown publicly together with your account name).',
        ],
      },
      {
        heading: '2. How we use this information',
        paragraphs: [
          'Your information is used to: operate your account, process and automatically deliver your orders, confirm blockchain deposit transactions, calculate discounts/VIP benefits, handle warranty and support requests, and for fraud prevention.',
        ],
      },
      {
        heading: '3. Password & API key security',
        paragraphs: [
          'Your account password is hashed before storage and cannot be reversed back into plain text — not even an Admin can see your real password.',
          'XCheap.top will never proactively ask you for your password via Telegram, email, or any channel other than the official login page on the website.',
          'An API key (if you generate one) can act on your behalf — keep it strictly confidential. You may regenerate a new API key (instantly invalidating the old one) at any time from the API Docs page.',
        ],
      },
      {
        heading: '4. Blockchain transactions & public visibility',
        paragraphs: [
          'Deposits are made over public blockchain networks (BSC, Polygon, TRC, Base). By the very nature of blockchain technology, the transaction hash and wallet address are public on-chain data that anyone can look up via a block explorer — this applies universally, not just to XCheap.top, and is not information XCheap.top itself exposed.',
        ],
      },
      {
        heading: '5. Sharing & internal access',
        paragraphs: [
          "XCheap.top does not sell your personal information to third parties.",
          'Internally, only the XCheap.top operating team (the CTV/Admin staff responsible for an order) can access account data when necessary to process orders, warranty claims, or support requests.',
          'Information is shared externally only when: you voluntarily reach out via Telegram support (that conversation lives inside your own Telegram app), or when required by a lawful request from the relevant authorities.',
        ],
      },
      {
        heading: '6. Cookies & browser storage',
        paragraphs: [
          'XCheap.top uses a login session cookie to keep you signed in, and the browser\'s local storage (localStorage) to remember your theme preference (light/dark) — this data stays on your own browser and is not sent to the server for any other purpose.',
        ],
      },
      {
        heading: '7. Data retention',
        paragraphs: [
          'Account data and transaction history are kept for as long as you use the service, to support purchase-history lookups, warranty processing, and applicable legal record-keeping obligations for financial transactions.',
        ],
      },
      {
        heading: '8. Your rights over your personal data',
        paragraphs: [
          'Under applicable personal data protection law (Decree 13/2023/NĐ-CP), you have the right to request access to, correction of, or deletion of your account information — except for data that must be retained under applicable law (for example, financial transaction records).',
          'To exercise these rights, please reach out via Telegram support, available under "Support" in the account menu.',
        ],
      },
      {
        heading: '9. Changes to this policy',
        paragraphs: [
          'This policy may be updated over time to accurately reflect how data is actually collected and processed. The most recent update date is always shown at the top of this page.',
        ],
      },
      {
        heading: '10. Contact',
        paragraphs: [
          'For any question about this privacy policy, please reach out via Telegram support, available under "Support" in the account menu.',
        ],
      },
    ],
  },
  zh: {
    title: '隐私政策',
    lastUpdated: '最后更新：2026年9月17日',
    intro: '本政策说明 XCheap.top 如何收集、使用和保护您的账户信息。请仔细阅读，以了解您在使用本服务时的权利与责任。',
    sections: [
      {
        heading: '1. 我们收集的信息',
        paragraphs: [
          '账户信息：用户名、邮箱、密码（单向哈希加密存储，从不以明文保存）、您提供的手机号码和 Telegram 账号、账户角色（用户/CTV/管理员）以及余额。',
          '充值钱包：每个账户在所支持的加密货币网络（BSC、Polygon、TRC、Base）上均会分配专属的充值地址。',
          '交易记录：已购买的订单、充值交易记录（含链上交易哈希）以及提现申请。',
          '您自愿提供的内容：商品评价（连同您的账户名一并公开展示）。',
        ],
      },
      {
        heading: '2. 我们如何使用这些信息',
        paragraphs: [
          '您的信息用于：运营您的账户、处理并自动发货订单、确认区块链充值交易、计算折扣/VIP 权益、处理保修与客服请求，以及防范欺诈。',
        ],
      },
      {
        heading: '3. 密码与 API 密钥安全',
        paragraphs: [
          '您的账户密码在存储前会经过哈希处理，无法反向还原为明文——即使是管理员也无法看到您的真实密码。',
          'XCheap.top 绝不会通过 Telegram、电子邮件或除官方网站登录页面以外的任何渠道主动向您索要密码。',
          'API 密钥（如您自行生成）可代表您执行操作——请务必严格保密。您可随时在 API Docs 页面重新生成新密钥（旧密钥将立即失效）。',
        ],
      },
      {
        heading: '4. 区块链交易与公开可见性',
        paragraphs: [
          '充值通过公开的区块链网络（BSC、Polygon、TRC、Base）完成。根据区块链技术的本质，交易哈希和钱包地址属于链上公开数据，任何人都可通过区块浏览器查询——这一点普遍适用，并非仅限于 XCheap.top，也并非 XCheap.top 自身泄露的信息。',
        ],
      },
      {
        heading: '5. 信息共享与内部访问权限',
        paragraphs: [
          'XCheap.top 不会将您的个人信息出售给第三方。',
          '在内部，只有 XCheap.top 运营团队（负责相关订单的 CTV/Admin 人员）在处理订单、保修申请或客服请求时才可访问账户数据。',
          '仅在以下情况下才会对外共享信息：您主动通过 Telegram 联系客服（该对话保存在您自己的 Telegram 应用内），或依据有关部门的合法要求。',
        ],
      },
      {
        heading: '6. Cookie 与浏览器存储',
        paragraphs: [
          'XCheap.top 使用登录会话 Cookie 以保持您的登录状态，并使用浏览器本地存储 (localStorage) 记住您的主题偏好（浅色/深色）——这些数据仅保存在您自己的浏览器中，不会因其他目的被发送至服务器。',
        ],
      },
      {
        heading: '7. 数据保留期限',
        paragraphs: [
          '账户数据及交易记录将在您使用本服务期间持续保留，以支持购买记录查询、保修处理，以及相关金融交易记录的法定留存义务。',
        ],
      },
      {
        heading: '8. 您对个人数据享有的权利',
        paragraphs: [
          '根据现行个人数据保护相关法规（第13/2023/NĐ-CP号法令），您有权要求访问、更正或删除您的账户信息——但依法必须留存的数据（例如金融交易记录）除外。',
          '如需行使上述权利，请通过账户菜单中的"支持"前往 Telegram 联系客服。',
        ],
      },
      {
        heading: '9. 政策变更',
        paragraphs: [
          '本政策可能会随着数据实际收集与处理方式的变化而更新，页面顶部始终显示最新的更新日期。',
        ],
      },
      {
        heading: '10. 联系我们',
        paragraphs: [
          '如对本隐私政策有任何疑问，请通过账户菜单中的"支持"前往 Telegram 联系客服。',
        ],
      },
    ],
  },
  th: {
    title: 'นโยบายความเป็นส่วนตัว',
    lastUpdated: 'อัปเดตล่าสุด: 17 กันยายน 2026',
    intro:
      'นโยบายนี้อธิบายว่า XCheap.top เก็บรวบรวม ใช้ และปกป้องข้อมูลบัญชีของคุณอย่างไร กรุณาอ่านให้ละเอียดเพื่อทำความเข้าใจสิทธิและความรับผิดชอบของคุณในการใช้บริการ',
    sections: [
      {
        heading: '1. ข้อมูลที่เราเก็บรวบรวม',
        paragraphs: [
          'ข้อมูลบัญชี: ชื่อผู้ใช้, อีเมล, รหัสผ่าน (เข้ารหัสแบบทางเดียว ไม่เก็บเป็นข้อความธรรมดา), หมายเลขโทรศัพท์และ Telegram หากคุณให้ข้อมูล, บทบาทบัญชี (ผู้ใช้/CTV/ผู้ดูแลระบบ) และยอดเงินคงเหลือ',
          'กระเป๋าเงินสำหรับเติมเงิน: แต่ละบัญชีจะได้รับที่อยู่กระเป๋าเงินเฉพาะของตนเองบนเครือข่ายคริปโตที่รองรับ (BSC, Polygon, TRC, Base)',
          'ประวัติธุรกรรม: คำสั่งซื้อที่ซื้อไปแล้ว, ธุรกรรมการเติมเงิน (รวมถึงแฮชธุรกรรมบนบล็อกเชน) และคำขอถอนเงิน',
          'เนื้อหาที่คุณให้ด้วยความสมัครใจ: รีวิวสินค้า (แสดงต่อสาธารณะพร้อมชื่อบัญชีของคุณ)',
        ],
      },
      {
        heading: '2. เราใช้ข้อมูลนี้อย่างไร',
        paragraphs: [
          'ข้อมูลของคุณถูกใช้เพื่อ: ดำเนินการบัญชีของคุณ, ประมวลผลและจัดส่งคำสั่งซื้อโดยอัตโนมัติ, ยืนยันธุรกรรมเติมเงินบนบล็อกเชน, คำนวณส่วนลด/สิทธิพิเศษ VIP, จัดการคำขอรับประกันและการสนับสนุน, และป้องกันการฉ้อโกง',
        ],
      },
      {
        heading: '3. ความปลอดภัยของรหัสผ่านและ API Key',
        paragraphs: [
          'รหัสผ่านบัญชีของคุณจะถูกเข้ารหัสแบบแฮชก่อนจัดเก็บ และไม่สามารถถอดกลับเป็นข้อความธรรมดาได้ — แม้แต่ผู้ดูแลระบบก็ไม่สามารถเห็นรหัสผ่านจริงของคุณได้',
          'XCheap.top จะไม่มีวันขอรหัสผ่านของคุณผ่าน Telegram, อีเมล หรือช่องทางใด ๆ นอกเหนือจากหน้าเข้าสู่ระบบอย่างเป็นทางการบนเว็บไซต์',
          'API Key (หากคุณสร้างขึ้น) สามารถดำเนินการแทนคุณได้ — กรุณาเก็บเป็นความลับอย่างเคร่งครัด คุณสามารถสร้าง API Key ใหม่ได้ทุกเมื่อ (ทำให้ Key เดิมใช้งานไม่ได้ทันที) ที่หน้า API Docs',
        ],
      },
      {
        heading: '4. ธุรกรรมบล็อกเชนและการมองเห็นแบบสาธารณะ',
        paragraphs: [
          'การเติมเงินทำผ่านเครือข่ายบล็อกเชนสาธารณะ (BSC, Polygon, TRC, Base) โดยธรรมชาติของเทคโนโลยีบล็อกเชน แฮชธุรกรรมและที่อยู่กระเป๋าเงินเป็นข้อมูลสาธารณะบนเชนที่ใครก็ตามสามารถตรวจสอบได้ผ่าน block explorer — สิ่งนี้เป็นจริงโดยทั่วไป ไม่ใช่เฉพาะ XCheap.top และไม่ใช่ข้อมูลที่ XCheap.top เป็นผู้เปิดเผยเอง',
        ],
      },
      {
        heading: '5. การแบ่งปันข้อมูลและการเข้าถึงภายใน',
        paragraphs: [
          'XCheap.top จะไม่ขายข้อมูลส่วนบุคคลของคุณให้บุคคลที่สาม',
          'ภายในองค์กร มีเพียงทีมงานปฏิบัติการของ XCheap.top (เจ้าหน้าที่ CTV/Admin ที่รับผิดชอบคำสั่งซื้อนั้น) เท่านั้นที่สามารถเข้าถึงข้อมูลบัญชีเมื่อจำเป็นสำหรับการประมวลผลคำสั่งซื้อ คำขอรับประกัน หรือการสนับสนุน',
          'ข้อมูลจะถูกแบ่งปันออกไปภายนอกเฉพาะเมื่อ: คุณติดต่อฝ่ายสนับสนุนผ่าน Telegram ด้วยตนเอง (บทสนทนานั้นอยู่ในแอป Telegram ของคุณเอง) หรือเมื่อมีคำขอที่ชอบด้วยกฎหมายจากหน่วยงานที่เกี่ยวข้อง',
        ],
      },
      {
        heading: '6. คุกกี้และการจัดเก็บข้อมูลในเบราว์เซอร์',
        paragraphs: [
          'XCheap.top ใช้คุกกี้เซสชันการเข้าสู่ระบบเพื่อให้คุณอยู่ในสถานะเข้าสู่ระบบ และใช้ที่เก็บข้อมูลในเบราว์เซอร์ (localStorage) เพื่อจดจำการตั้งค่าธีม (สว่าง/มืด) — ข้อมูลนี้อยู่บนเบราว์เซอร์ของคุณเองเท่านั้น ไม่ถูกส่งไปยังเซิร์ฟเวอร์เพื่อวัตถุประสงค์อื่นใด',
        ],
      },
      {
        heading: '7. ระยะเวลาการเก็บรักษาข้อมูล',
        paragraphs: [
          'ข้อมูลบัญชีและประวัติธุรกรรมจะถูกเก็บรักษาไว้ตลอดระยะเวลาที่คุณใช้บริการ เพื่อรองรับการตรวจสอบประวัติการซื้อ การดำเนินการรับประกัน และภาระผูกพันทางกฎหมายในการเก็บรักษาบันทึกธุรกรรมทางการเงินที่เกี่ยวข้อง',
        ],
      },
      {
        heading: '8. สิทธิของคุณเกี่ยวกับข้อมูลส่วนบุคคล',
        paragraphs: [
          'ภายใต้กฎหมายคุ้มครองข้อมูลส่วนบุคคลที่บังคับใช้ (พระราชกฤษฎีกาเลขที่ 13/2023/NĐ-CP) คุณมีสิทธิ์ขอเข้าถึง แก้ไข หรือขอให้ลบข้อมูลบัญชีของคุณ — ยกเว้นข้อมูลที่ต้องเก็บรักษาไว้ตามกฎหมาย (เช่น บันทึกธุรกรรมทางการเงิน)',
          'หากต้องการใช้สิทธิ์เหล่านี้ กรุณาติดต่อฝ่ายสนับสนุนผ่าน Telegram ได้ที่เมนู "สนับสนุน" ในเมนูบัญชีของคุณ',
        ],
      },
      {
        heading: '9. การเปลี่ยนแปลงนโยบาย',
        paragraphs: [
          'นโยบายนี้อาจได้รับการปรับปรุงตามการเก็บรวบรวมและประมวลผลข้อมูลที่เกิดขึ้นจริง วันที่อัปเดตล่าสุดจะแสดงอยู่ด้านบนของหน้านี้เสมอ',
        ],
      },
      {
        heading: '10. ติดต่อเรา',
        paragraphs: [
          'หากมีข้อสงสัยเกี่ยวกับนโยบายความเป็นส่วนตัวนี้ กรุณาติดต่อฝ่ายสนับสนุนผ่าน Telegram ได้ที่เมนู "สนับสนุน" ในเมนูบัญชีของคุณ',
        ],
      },
    ],
  },

  ja: {
    title: 'プライバシーポリシー',
    lastUpdated: '最終更新日：2026年9月17日',
    intro:
      '本ポリシーは、XCheap.topがお客様のアカウント情報をどのように収集・利用・保護しているかについて説明するものです。サービスをご利用いただく際の権利と責任を正しくご理解いただくため、必ず内容をご確認ください。',
    sections: [
      {
        heading: '1. 収集する情報',
        paragraphs: [
          'アカウント情報：ユーザー名、メールアドレス、パスワード（一方向ハッシュ化され、平文では一切保存されません）、ご提供いただいた場合の電話番号およびTelegramアカウント、アカウント権限（会員／CTV／管理者）、残高。',
          '入金ウォレット：各アカウントには、対応するすべての暗号資産ネットワーク（BSC、Polygon、TRC、Base）ごとに専用の入金アドレスが発行されます。',
          '取引履歴：購入注文、入金取引（オンチェーン上のトランザクションハッシュを含む）、出金リクエスト。',
          'お客様が任意でご提供いただく内容：商品レビュー（お客様のアカウント名とともに公開表示されます）。',
        ],
      },
      {
        heading: '2. 情報の利用目的',
        paragraphs: [
          'お客様の情報は、次の目的で利用されます：アカウントの運用、注文の処理および自動発送、ブロックチェーン入金取引の確認、割引／VIP特典の計算、保証・サポート対応、および不正防止。',
        ],
      },
      {
        heading: '3. パスワードおよびAPIキーのセキュリティ',
        paragraphs: [
          'アカウントのパスワードは保存前にハッシュ化され、平文に復元することはできません。管理者であっても、お客様の実際のパスワードを閲覧することはできません。',
          'XCheap.topが、Telegram・メールその他、公式ウェブサイトのログインページ以外の手段で、お客様に自らパスワードをお尋ねすることは一切ありません。',
          'APIキー（発行された場合）は、お客様に代わって操作を行うことができるため、厳重に管理してください。APIキーは、APIドキュメントページからいつでも再発行（旧キーは即時に無効化）することができます。',
        ],
      },
      {
        heading: '4. ブロックチェーン取引と公開性について',
        paragraphs: [
          '入金は、公開されたブロックチェーンネットワーク（BSC、Polygon、TRC、Base）を通じて行われます。ブロックチェーン技術の性質上、トランザクションハッシュおよびウォレットアドレスは、ブロックエクスプローラーを通じて誰でも閲覧可能な公開データです。これはXCheap.topに限った話ではなく、ブロックチェーン全般に共通する仕組みであり、XCheap.top自身が独自に公開している情報ではありません。',
        ],
      },
      {
        heading: '5. 情報の共有と社内アクセス',
        paragraphs: [
          'XCheap.topは、お客様の個人情報を第三者に販売することはありません。',
          '社内においては、注文・保証申請・サポート対応の処理に必要な場合に限り、XCheap.top運営チーム（当該注文を担当するCTV／管理者スタッフ）のみがアカウント情報にアクセスできます。',
          '外部への情報提供は、お客様ご自身がTelegramサポートへ任意でご連絡された場合（その会話はお客様ご自身のTelegramアプリ内に保存されます）、または関係当局からの法的に正当な要請があった場合に限られます。',
        ],
      },
      {
        heading: '6. Cookieおよびブラウザストレージ',
        paragraphs: [
          'XCheap.topは、ログイン状態を維持するためのセッションCookie、およびテーマ設定（ライト／ダークモード）を記憶するためのブラウザのローカルストレージ（localStorage）を使用します。これらのデータはお客様ご自身のブラウザ内にのみ保存され、それ以外の目的でサーバーに送信されることはありません。',
        ],
      },
      {
        heading: '7. データの保存期間',
        paragraphs: [
          'アカウント情報および取引履歴は、購入履歴の確認、保証対応、および金融取引に関する法令上の記録保持義務に対応するため、お客様がサービスをご利用いただいている間、保存されます。',
        ],
      },
      {
        heading: '8. ご自身の個人データに関する権利',
        paragraphs: [
          '適用される個人データ保護法令（政令13/2023/NĐ-CP）に基づき、お客様はご自身のアカウント情報の閲覧・訂正・削除を請求する権利を有します。ただし、法令上保存が義務付けられているデータ（金融取引記録など）は除きます。',
          'これらの権利を行使される場合は、アカウントメニュー内の「サポート」からご利用いただけるTelegramサポートまでご連絡ください。',
        ],
      },
      {
        heading: '9. 本ポリシーの変更',
        paragraphs: [
          '本ポリシーは、実際のデータ収集・処理方法を正確に反映するため、随時更新される場合があります。最新の更新日は、本ページ上部に常時表示されます。',
        ],
      },
      {
        heading: '10. お問い合わせ',
        paragraphs: [
          '本プライバシーポリシーに関するご質問は、アカウントメニュー内の「サポート」からご利用いただけるTelegramサポートまでお気軽にお問い合わせください。',
        ],
      },
    ],
  },
};

export const PrivacyPage: React.FC<PrivacyPageProps> = ({ language, onBackToStore }) => {
  const content = PRIVACY_CONTENT[language];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <button
        onClick={onBackToStore}
        className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{language === 'vn' ? 'Về trang chủ' : language === 'zh' ? '返回首页' : language === 'th' ? 'กลับหน้าแรก' : language === 'ja' ? 'ホームに戻る' : 'Back to store'}</span>
      </button>

      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-5 sm:p-7 mb-4">
        <div className="flex items-start gap-3.5 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">{content.title}</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-500 font-mono mt-0.5">{content.lastUpdated}</p>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-3">{content.intro}</p>
      </div>

      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl divide-y divide-[#e1e4e3] dark:divide-[#32363e]">
        {content.sections.map((section, idx) => (
          <div key={idx} className="p-5 sm:p-7">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">{section.heading}</h2>
            <div className="space-y-2">
              {section.paragraphs.map((para, pIdx) => (
                <p key={pIdx} className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {para}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
