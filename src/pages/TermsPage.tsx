import React from 'react';
import { Language } from '../types';
import { ArrowLeft, FileText } from 'lucide-react';

interface TermsPageProps {
  language: Language;
  onBackToStore: () => void;
}

interface TermsSection {
  heading: string;
  paragraphs: string[];
}

interface TermsContent {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: TermsSection[];
}

// Real terms grounded in how this store actually works. Framed as an
// agreement between the User (buyer) and XCheap.us — CTV and Admin accounts
// are XCheap.us's own internal listing/operating accounts, not independent
// third-party sellers, so section 3 treats them as one and the same rather
// than as a separate contracting party with its own obligations section.
// The warranty wording in section 7 mirrors the exact policy already shown
// on every product page (pdWarranty24h* keys in translations.ts) rather than
// inventing separate numbers. Kept local to this page (rather than
// translations.ts) since it's long-form prose specific to a single page, not
// a short reusable UI string.
const TERMS_CONTENT: Record<Language, TermsContent> = {
  vn: {
    title: 'Điều khoản dịch vụ',
    lastUpdated: 'Cập nhật lần cuối: 17/09/2026',
    intro:
      'Điều khoản này là thỏa thuận giữa bạn (Người dùng) và XCheap.us khi bạn tạo tài khoản, mua hàng và sử dụng dịch vụ. Vui lòng đọc kỹ trước khi đăng ký hoặc mua hàng.',
    sections: [
      {
        heading: '1. Chấp nhận điều khoản',
        paragraphs: [
          'Việc tích chọn ô "Tôi đã đọc và đồng ý với Điều khoản dịch vụ" khi đăng ký, hoặc việc tiếp tục sử dụng website sau khi điều khoản được cập nhật, đồng nghĩa với việc bạn chấp nhận toàn bộ nội dung tại trang này.',
          'Điều khoản này là thỏa thuận giữa bạn (Người dùng) và XCheap.us, áp dụng mỗi khi bạn đăng ký, mua hàng hoặc sử dụng dịch vụ.',
          'Nếu không đồng ý với bất kỳ điều khoản nào, vui lòng ngừng sử dụng dịch vụ.',
        ],
      },
      {
        heading: '2. Dịch vụ cung cấp',
        paragraphs: [
          'XCheap.us là nền tảng mua bán tài khoản số (Twitter/X, Facebook, Gmail/Google, Instagram, Discord và các danh mục khác được niêm yết trên trang chủ). Mỗi biến thể sản phẩm hiển thị đúng số lượng tồn kho thật tại thời điểm truy cập.',
          'Nếu sản phẩm hết hàng, bạn có thể đặt trước (pre-order); đơn đặt trước chỉ được trừ tiền khi có hàng thật và tự động giao.',
        ],
      },
      {
        heading: '3. Về Cộng tác viên (CTV) & Quản trị viên (Admin)',
        paragraphs: [
          'Tài khoản Cộng tác viên (CTV) và Quản trị viên (Admin) đều là tài khoản vận hành do chính đội ngũ XCheap.us trực tiếp quản lý để đăng bán và vận hành sản phẩm trên sàn — không phải bên bán độc lập bên thứ ba.',
          'Trong phạm vi điều khoản này, CTV và Admin được xem là một, đại diện cho XCheap.us với tư cách bên bán. Điều khoản này là thỏa thuận giữa bạn (Người dùng) và XCheap.us, không áp dụng như một hợp đồng riêng giữa XCheap.us với tài khoản CTV hay Admin.',
        ],
      },
      {
        heading: '4. Tài khoản người dùng & bảo mật',
        paragraphs: [
          'Bạn chịu trách nhiệm bảo mật mật khẩu đăng nhập XCheap.us và mọi hoạt động diễn ra dưới tài khoản của mình.',
          'Sau khi nhận tài khoản số đã mua, bạn nên đổi mật khẩu và bật bảo mật 2 lớp (nếu nền tảng gốc hỗ trợ) càng sớm càng tốt để tránh mất quyền kiểm soát.',
        ],
      },
      {
        heading: '5. Số dư & thanh toán',
        paragraphs: [
          'Nạp tiền được thực hiện qua chuyển khoản crypto (BSC, Polygon, TRC, Base) vào ví nạp riêng của tài khoản bạn; số dư được cộng tự động sau khi giao dịch trên blockchain được xác nhận.',
          'Giao dịch blockchain không thể đảo ngược — vui lòng kiểm tra kỹ mạng lưới và địa chỉ ví trước khi chuyển. XCheap.us không chịu trách nhiệm với các khoản chuyển sai mạng, sai địa chỉ do lỗi của người dùng.',
          'Khi mua hàng, số dư chỉ bị trừ khi đơn hàng được xác nhận thành công (đủ tồn kho và đủ số dư tại đúng thời điểm đặt hàng).',
        ],
      },
      {
        heading: '6. Đặt hàng & giao hàng',
        paragraphs: [
          'Tài khoản số được giao ngay tự động sau khi thanh toán thành công nếu còn hàng trong kho.',
          'Toàn bộ lịch sử đơn hàng và thông tin tài khoản đã mua được lưu lại trong mục "Lịch sử mua hàng" để bạn tra cứu lại bất cứ lúc nào.',
        ],
      },
      {
        heading: '7. Chính sách bảo hành & hoàn tiền',
        paragraphs: [
          'Bảo hành trong vòng 24 giờ kể từ thời điểm mua (1 đổi 1 hoặc hoàn tiền) áp dụng cho các trường hợp: thông tin đăng nhập không chính xác; tài khoản bị khóa hoặc suspend trước khi bàn giao; hoặc thông tin không đúng với mô tả sản phẩm.',
          'Ngoài phạm vi trên (ví dụ: tài khoản bị khóa do lỗi sử dụng của người mua, đổi mật khẩu chậm dẫn đến mất quyền truy cập, hoặc yêu cầu bảo hành sau 24 giờ), XCheap.us không có nghĩa vụ đổi/hoàn tiền.',
          'XCheap.us (thông qua đội ngũ CTV/Admin phụ trách sản phẩm) là bên trực tiếp thực hiện nghĩa vụ bảo hành này.',
        ],
      },
      {
        heading: '8. Nguồn gốc tài khoản & tuân thủ pháp luật',
        paragraphs: [
          'Toàn bộ tài khoản số niêm yết trên XCheap.us do đội ngũ CTV/Admin tự đăng ký (thường gọi là tài khoản "clone"/tài khoản tạo mới hàng loạt), không phải tài khoản chiếm đoạt hay truy cập trái phép từ người dùng thật khác.',
          'Việc đăng ký, sử dụng và giao dịch tài khoản mạng xã hội tại Việt Nam chịu sự điều chỉnh của pháp luật hiện hành, bao gồm nhưng không giới hạn ở quy định về xác thực tài khoản mạng xã hội (Nghị định 147/2024/NĐ-CP), bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP) và các quy định của Bộ luật Hình sự về hành vi xâm nhập trái phép mạng máy tính, chiếm đoạt hoặc mua bán trái phép thông tin tài khoản. Bạn tự chịu trách nhiệm tìm hiểu và tuân thủ các quy định pháp luật liên quan đến việc sở hữu, sử dụng tài khoản mà mình mua.',
          'XCheap.us không đại diện hay bảo đảm rằng việc mua bán tài khoản tuân thủ điều khoản sử dụng riêng của từng nền tảng gốc (Twitter/X, Meta, Google, Discord...) — các nền tảng này có toàn quyền tự khóa tài khoản theo chính sách riêng của họ bất cứ lúc nào, độc lập với XCheap.us.',
          'Nếu phát hiện hoặc có căn cứ cho rằng một tài khoản niêm yết có nguồn gốc từ hành vi chiếm đoạt trái phép, XCheap.us sẽ gỡ bỏ sản phẩm ngay lập tức, từ chối mọi yêu cầu bảo hành/hoàn tiền đối với tài khoản đó, và có thể cung cấp thông tin cho cơ quan chức năng khi được yêu cầu hợp pháp.',
        ],
      },
      {
        heading: '9. Hành vi bị nghiêm cấm',
        paragraphs: [
          'Nghiêm cấm sử dụng tài khoản và dịch vụ với mục đích vi phạm pháp luật.',
          'XCheap.us không chịu trách nhiệm cho bất kỳ hành vi nào sử dụng tài nguyên sai mục đích, và có quyền tạm khóa hoặc chấm dứt tài khoản vi phạm mà không cần báo trước.',
        ],
      },
      {
        heading: '10. Giới hạn trách nhiệm',
        paragraphs: [
          'Dịch vụ được cung cấp trên cơ sở "hiện có" (as-is). Trong phạm vi pháp luật cho phép, XCheap.us không chịu trách nhiệm cho các thiệt hại gián tiếp phát sinh từ việc sử dụng tài khoản số đã mua, ngoài phạm vi chính sách bảo hành tại mục 7.',
        ],
      },
      {
        heading: '11. Thay đổi điều khoản',
        paragraphs: [
          'Điều khoản này có thể được cập nhật theo thời gian để phản ánh đúng cách vận hành thực tế của dịch vụ và các thay đổi của pháp luật liên quan. Ngày cập nhật gần nhất luôn hiển thị ở đầu trang.',
        ],
      },
      {
        heading: '12. Liên hệ',
        paragraphs: [
          'Mọi thắc mắc về điều khoản dịch vụ, vui lòng liên hệ hỗ trợ qua Telegram tại mục "Hỗ trợ" trong menu tài khoản.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms of Service',
    lastUpdated: 'Last updated: Sep 17, 2026',
    intro:
      'These terms are an agreement between you (the User) and XCheap.us when you create an account, make a purchase, and use the service. Please read them carefully before registering or making a purchase.',
    sections: [
      {
        heading: '1. Acceptance of terms',
        paragraphs: [
          'Checking "I have read and agree to the Terms of Service" during registration, or continuing to use the site after these terms are updated, means you accept everything on this page.',
          'These terms are an agreement between you (the User) and XCheap.us, and apply whenever you register, make a purchase, or use the service.',
          'If you do not agree with any part of these terms, please stop using the service.',
        ],
      },
      {
        heading: '2. Service provided',
        paragraphs: [
          'XCheap.us is a digital account marketplace (Twitter/X, Facebook, Gmail/Google, Instagram, Discord, and other categories listed on the homepage). Each product variant shows the real, live stock count at the time you view it.',
          'If a variant is out of stock, you may place a pre-order; a pre-order is only charged once real stock becomes available and is fulfilled automatically.',
        ],
      },
      {
        heading: '3. About Partners/Resellers (CTV) & Admins',
        paragraphs: [
          'Partner/Reseller (CTV) and Admin accounts are operating accounts directly managed by the XCheap.us team to list and run products on the store — they are not independent third-party sellers.',
          'For the purposes of these terms, CTV and Admin are treated as one and the same, acting on behalf of XCheap.us as the seller. These terms are an agreement between you (the User) and XCheap.us, not a separate contract between XCheap.us and a CTV or Admin account.',
        ],
      },
      {
        heading: '4. User accounts & security',
        paragraphs: [
          'You are responsible for keeping your XCheap.us login credentials safe and for all activity under your account.',
          'After receiving a purchased digital account, you should change its password and enable two-factor authentication (if the underlying platform supports it) as soon as possible to avoid losing control of it.',
        ],
      },
      {
        heading: '5. Balance & payment',
        paragraphs: [
          'Deposits are made via crypto transfer (BSC, Polygon, TRC, Base) to your own deposit wallet; your balance is credited automatically once the on-chain transaction is confirmed.',
          'Blockchain transactions cannot be reversed — please double-check the network and wallet address before sending. XCheap.us is not responsible for transfers sent to the wrong network or address due to user error.',
          'On checkout, your balance is only deducted once an order is confirmed successfully (sufficient stock and sufficient balance at the exact moment of purchase).',
        ],
      },
      {
        heading: '6. Orders & delivery',
        paragraphs: [
          'Digital accounts are delivered automatically and immediately after a successful payment, provided stock is available.',
          'Every order and the account details you received are kept in "Purchase History" so you can look them up again at any time.',
        ],
      },
      {
        heading: '7. Warranty & refund policy',
        paragraphs: [
          'A 24-hour warranty from the time of purchase (1-to-1 replacement or refund) applies to: incorrect login credentials; the account being locked or suspended before it was handed over; or the account not matching its listed description.',
          'Outside of these cases (for example, an account locked due to the buyer\'s own misuse, losing access because the password was not changed promptly, or a warranty claim made after 24 hours), XCheap.us has no obligation to replace or refund.',
          'XCheap.us (through the CTV/Admin team responsible for the product) is the party that directly fulfills this warranty obligation.',
        ],
      },
      {
        heading: '8. Account origin & legal compliance',
        paragraphs: [
          'Every digital account listed on XCheap.us is self-registered by its CTV/Admin team (commonly called a "clone" or bulk-registered account), not an account taken over or accessed without authorization from another real user.',
          'Registering, using, and trading social media accounts in Vietnam is governed by applicable law, including but not limited to social network account verification requirements (Decree 147/2024/NĐ-CP), personal data protection (Decree 13/2023/NĐ-CP), and Penal Code provisions on unauthorized computer intrusion, account takeover, or illegal trading of account information. You are responsible for understanding and complying with the laws applicable to owning and using the account you purchase.',
          'XCheap.us does not represent or warrant that any account transaction complies with the individual terms of service of the underlying platform (Twitter/X, Meta, Google, Discord, etc.) — those platforms may suspend an account under their own policies at any time, independently of XCheap.us.',
          'If XCheap.us discovers or has reason to believe a listed account originated from unauthorized account takeover, it will remove the listing immediately, deny any warranty or refund claim on that account, and may provide information to the relevant authorities upon lawful request.',
        ],
      },
      {
        heading: '9. Prohibited conduct',
        paragraphs: [
          'Using any account or service purchased here for unlawful purposes is strictly prohibited.',
          'XCheap.us is not liable for any misuse of purchased resources, and reserves the right to suspend or terminate a violating account without prior notice.',
        ],
      },
      {
        heading: '10. Limitation of liability',
        paragraphs: [
          'The service is provided "as is." To the extent permitted by law, XCheap.us is not liable for indirect damages arising from the use of a purchased digital account, beyond what is covered by the warranty policy in section 7.',
        ],
      },
      {
        heading: '11. Changes to these terms',
        paragraphs: [
          'These terms may be updated over time to accurately reflect how the service actually operates and changes in applicable law. The most recent update date is always shown at the top of this page.',
        ],
      },
      {
        heading: '12. Contact',
        paragraphs: [
          'For any question about these terms, please reach out via Telegram support, available under "Support" in the account menu.',
        ],
      },
    ],
  },
  zh: {
    title: '服务条款',
    lastUpdated: '最后更新：2026年9月17日',
    intro:
      '本条款是您（用户）与 XCheap.us 之间的协议，适用于您创建账户、购买商品及使用本服务。请在注册或购买前仔细阅读。',
    sections: [
      {
        heading: '1. 条款接受',
        paragraphs: [
          '在注册时勾选"我已阅读并同意服务条款"，或在条款更新后继续使用本网站，均表示您接受本页面的全部内容。',
          '本条款是您（用户）与 XCheap.us 之间的协议，适用于您注册、购买或使用本服务的任何情形。',
          '如果您不同意其中任何条款，请停止使用本服务。',
        ],
      },
      {
        heading: '2. 提供的服务',
        paragraphs: [
          'XCheap.us 是一个数字账号交易平台（Twitter/X、Facebook、Gmail/Google、Instagram、Discord 及首页列出的其他分类）。每个商品规格显示的都是您访问时的真实实时库存数量。',
          '若商品暂时缺货，您可以下预订单；预订单仅在实际到货并自动发货时才会扣款。',
        ],
      },
      {
        heading: '3. 关于分销合伙人 (CTV) 与管理员 (Admin)',
        paragraphs: [
          '分销合伙人 (CTV) 账户与管理员 (Admin) 账户均由 XCheap.us 团队自行直接管理，用于在平台上架和运营商品——并非独立的第三方卖家。',
          '就本条款而言，CTV 与 Admin 视为同一主体，代表 XCheap.us 以卖家身份行事。本条款是您（用户）与 XCheap.us 之间的协议，并非 XCheap.us 与 CTV 或 Admin 账户之间的独立合同。',
        ],
      },
      {
        heading: '4. 用户账户与安全',
        paragraphs: [
          '您有责任妥善保管自己的 XCheap.us 登录信息，并对账户下的所有操作负责。',
          '收到购买的数字账号后，请尽快修改密码并（如原平台支持）开启双重验证，以免失去对账号的控制权。',
        ],
      },
      {
        heading: '5. 余额与支付',
        paragraphs: [
          '充值通过加密货币转账（BSC、Polygon、TRC、Base）完成，转入您专属的充值钱包；链上交易确认后余额会自动到账。',
          '区块链交易不可撤销——转账前请仔细核对网络和钱包地址。因用户自身失误转错网络或地址造成的损失，XCheap.us 概不负责。',
          '下单时，只有在订单成功确认（下单当下库存充足且余额充足）后才会扣除余额。',
        ],
      },
      {
        heading: '6. 订单与发货',
        paragraphs: [
          '只要有库存，数字账号会在支付成功后立即自动发货。',
          '所有订单及已购买的账号信息都会保存在"购买记录"中，方便您随时查阅。',
        ],
      },
      {
        heading: '7. 保修与退款政策',
        paragraphs: [
          '自购买时起24小时内提供保修（1对1换货或退款），适用情形为：登录信息不正确；账号在交付前被封禁或暂停；或账号信息与商品描述不符。',
          '超出上述范围的情况（例如因买家自身操作不当导致账号被封、未及时修改密码导致失去访问权限，或在24小时后才提出保修申请），XCheap.us 不承担换货或退款义务。',
          'XCheap.us（通过负责该商品的 CTV/Admin 团队）是直接履行本保修义务的一方。',
        ],
      },
      {
        heading: '8. 账号来源与法律合规',
        paragraphs: [
          'XCheap.us 上架的所有数字账号均由其 CTV/Admin 团队自行注册（通常称为"克隆号"或批量注册账号），并非从其他真实用户处盗取或非法获取的账号。',
          '在越南境内注册、使用及交易社交媒体账号须遵守现行法律法规，包括但不限于社交网络账号实名认证相关规定（第147/2024/NĐ-CP号法令）、个人数据保护相关规定（第13/2023/NĐ-CP号法令），以及《刑法》中关于非法侵入计算机网络、盗用账号或非法交易账号信息的相关条款。您须自行了解并遵守与您所购买账号的所有权及使用相关的法律规定。',
          'XCheap.us 不代表也不保证任何账号交易符合原平台（Twitter/X、Meta、Google、Discord 等）各自的服务条款——这些平台可依据其自身政策随时独立于 XCheap.us 封禁账号。',
          '若 XCheap.us 发现或有合理理由认为某上架账号系通过非法盗用获得，将立即下架该商品、拒绝该账号的任何保修/退款申请，并可在收到合法要求时向有关部门提供相关信息。',
        ],
      },
      {
        heading: '9. 禁止行为',
        paragraphs: [
          '严禁将在本平台购买的任何账号或服务用于任何违法活动。',
          'XCheap.us 对资源的不当使用行为概不负责，并保留在不事先通知的情况下暂停或终止违规账号的权利。',
        ],
      },
      {
        heading: '10. 责任限制',
        paragraphs: [
          '本服务按"现状"提供。在法律允许的范围内，除第7条保修政策涵盖的内容外，XCheap.us 对因使用已购数字账号而产生的间接损失不承担责任。',
        ],
      },
      {
        heading: '11. 条款变更',
        paragraphs: [
          '本条款可能会随着服务实际运营方式及相关法律法规的变化而更新，页面顶部始终显示最新的更新日期。',
        ],
      },
      {
        heading: '12. 联系我们',
        paragraphs: [
          '如对本服务条款有任何疑问，请通过账户菜单中的"支持"前往 Telegram 联系客服。',
        ],
      },
    ],
  },
  th: {
    title: 'ข้อกำหนดการให้บริการ',
    lastUpdated: 'อัปเดตล่าสุด: 17 กันยายน 2026',
    intro:
      'ข้อกำหนดนี้เป็นข้อตกลงระหว่างคุณ (ผู้ใช้) กับ XCheap.us เมื่อคุณสร้างบัญชี สั่งซื้อ และใช้งานบริการ กรุณาอ่านให้ละเอียดก่อนสมัครสมาชิกหรือสั่งซื้อ',
    sections: [
      {
        heading: '1. การยอมรับข้อกำหนด',
        paragraphs: [
          'การทำเครื่องหมายที่ "ฉันได้อ่านและยอมรับข้อกำหนดการให้บริการ" ขณะสมัครสมาชิก หรือการใช้งานเว็บไซต์ต่อไปหลังจากข้อกำหนดได้รับการอัปเดต ถือว่าคุณยอมรับเนื้อหาทั้งหมดในหน้านี้',
          'ข้อกำหนดนี้เป็นข้อตกลงระหว่างคุณ (ผู้ใช้) กับ XCheap.us ซึ่งมีผลใช้บังคับทุกครั้งที่คุณสมัครสมาชิก สั่งซื้อ หรือใช้งานบริการ',
          'หากคุณไม่ยอมรับข้อกำหนดข้อใดข้อหนึ่ง กรุณาหยุดใช้บริการ',
        ],
      },
      {
        heading: '2. บริการที่ให้',
        paragraphs: [
          'XCheap.us เป็นแพลตฟอร์มซื้อขายบัญชีดิจิทัล (Twitter/X, Facebook, Gmail/Google, Instagram, Discord และหมวดหมู่อื่น ๆ ที่แสดงบนหน้าแรก) สินค้าแต่ละตัวเลือกจะแสดงจำนวนสต็อกจริงตามเวลาที่คุณเข้าชม',
          'หากสินค้าหมดสต็อก คุณสามารถสั่งจองล่วงหน้าได้ โดยจะถูกหักเงินก็ต่อเมื่อมีสินค้าจริงและระบบจัดส่งให้อัตโนมัติเท่านั้น',
        ],
      },
      {
        heading: '3. เกี่ยวกับตัวแทนจำหน่าย (CTV) และผู้ดูแลระบบ (Admin)',
        paragraphs: [
          'บัญชีตัวแทนจำหน่าย (CTV) และบัญชีผู้ดูแลระบบ (Admin) เป็นบัญชีปฏิบัติการที่ทีมงาน XCheap.us บริหารจัดการโดยตรงเพื่อลงขายและดำเนินการสินค้าบนแพลตฟอร์ม — ไม่ใช่ผู้ขายอิสระจากบุคคลที่สาม',
          'ภายใต้ข้อกำหนดนี้ CTV และ Admin ถือเป็นฝ่ายเดียวกัน โดยทำหน้าที่แทน XCheap.us ในฐานะผู้ขาย ข้อกำหนดนี้เป็นข้อตกลงระหว่างคุณ (ผู้ใช้) กับ XCheap.us ไม่ใช่สัญญาแยกต่างหากระหว่าง XCheap.us กับบัญชี CTV หรือ Admin',
        ],
      },
      {
        heading: '4. บัญชีผู้ใช้และความปลอดภัย',
        paragraphs: [
          'คุณมีหน้าที่รักษาความปลอดภัยของข้อมูลเข้าสู่ระบบ XCheap.us และรับผิดชอบต่อกิจกรรมทั้งหมดที่เกิดขึ้นภายใต้บัญชีของคุณ',
          'หลังจากได้รับบัญชีดิจิทัลที่ซื้อแล้ว ควรเปลี่ยนรหัสผ่านและเปิดใช้งานการยืนยันตัวตนสองชั้น (หากแพลตฟอร์มต้นทางรองรับ) โดยเร็วที่สุดเพื่อป้องกันการสูญเสียสิทธิ์ควบคุมบัญชี',
        ],
      },
      {
        heading: '5. ยอดเงินและการชำระเงิน',
        paragraphs: [
          'การเติมเงินทำผ่านการโอนคริปโต (BSC, Polygon, TRC, Base) เข้ากระเป๋าเงินสำหรับเติมเงินของคุณโดยเฉพาะ ยอดเงินจะถูกเพิ่มโดยอัตโนมัติหลังจากธุรกรรมบนบล็อกเชนได้รับการยืนยัน',
          'ธุรกรรมบล็อกเชนไม่สามารถย้อนกลับได้ กรุณาตรวจสอบเครือข่ายและที่อยู่กระเป๋าเงินให้ถูกต้องก่อนโอน XCheap.us ไม่รับผิดชอบต่อการโอนผิดเครือข่ายหรือผิดที่อยู่อันเกิดจากความผิดพลาดของผู้ใช้',
          'เมื่อทำการสั่งซื้อ ยอดเงินจะถูกหักก็ต่อเมื่อคำสั่งซื้อได้รับการยืนยันสำเร็จ (มีสต็อกเพียงพอและมียอดเงินเพียงพอ ณ เวลาที่สั่งซื้อจริง)',
        ],
      },
      {
        heading: '6. คำสั่งซื้อและการจัดส่ง',
        paragraphs: [
          'บัญชีดิจิทัลจะถูกจัดส่งโดยอัตโนมัติทันทีหลังชำระเงินสำเร็จ หากยังมีสต็อกอยู่',
          'ประวัติคำสั่งซื้อและข้อมูลบัญชีที่ซื้อทั้งหมดจะถูกบันทึกไว้ใน "ประวัติการซื้อ" เพื่อให้คุณสามารถตรวจสอบย้อนหลังได้ตลอดเวลา',
        ],
      },
      {
        heading: '7. นโยบายการรับประกันและการคืนเงิน',
        paragraphs: [
          'รับประกันภายใน 24 ชั่วโมงนับจากเวลาที่ซื้อ (เปลี่ยนใหม่ 1 ต่อ 1 หรือคืนเงิน) สำหรับกรณี: ข้อมูลเข้าสู่ระบบไม่ถูกต้อง, บัญชีถูกระงับหรือล็อกก่อนส่งมอบ, หรือข้อมูลไม่ตรงกับคำอธิบายสินค้า',
          'นอกเหนือจากกรณีข้างต้น (เช่น บัญชีถูกล็อกเนื่องจากความผิดพลาดของผู้ซื้อเอง, เปลี่ยนรหัสผ่านช้าจนสูญเสียสิทธิ์การเข้าถึง หรือแจ้งขอรับประกันหลังผ่านไป 24 ชั่วโมง) XCheap.us ไม่มีข้อผูกพันในการเปลี่ยนหรือคืนเงิน',
          'XCheap.us (ผ่านทีมงาน CTV/Admin ที่รับผิดชอบสินค้า) เป็นฝ่ายที่ปฏิบัติตามหน้าที่รับประกันนี้โดยตรง',
        ],
      },
      {
        heading: '8. ที่มาของบัญชีและการปฏิบัติตามกฎหมาย',
        paragraphs: [
          'บัญชีดิจิทัลทุกบัญชีที่ลงขายบน XCheap.us เป็นบัญชีที่ทีมงาน CTV/Admin ลงทะเบียนขึ้นเอง (มักเรียกว่าบัญชี "โคลน" หรือบัญชีที่สร้างขึ้นเป็นจำนวนมาก) ไม่ใช่บัญชีที่ถูกยึดหรือเข้าถึงโดยไม่ได้รับอนุญาตจากผู้ใช้จริงรายอื่น',
          'การลงทะเบียน การใช้งาน และการซื้อขายบัญชีโซเชียลมีเดียในเวียดนามอยู่ภายใต้กฎหมายที่บังคับใช้ รวมถึงแต่ไม่จำกัดเพียงข้อกำหนดเรื่องการยืนยันตัวตนบัญชีโซเชียลเน็ตเวิร์ก (พระราชกฤษฎีกาเลขที่ 147/2024/NĐ-CP) การคุ้มครองข้อมูลส่วนบุคคล (พระราชกฤษฎีกาเลขที่ 13/2023/NĐ-CP) และบทบัญญัติในประมวลกฎหมายอาญาว่าด้วยการบุกรุกระบบคอมพิวเตอร์โดยไม่ได้รับอนุญาต การยึดบัญชี หรือการซื้อขายข้อมูลบัญชีโดยผิดกฎหมาย คุณมีหน้าที่รับผิดชอบในการทำความเข้าใจและปฏิบัติตามกฎหมายที่เกี่ยวข้องกับการเป็นเจ้าของและการใช้งานบัญชีที่คุณซื้อด้วยตนเอง',
          'XCheap.us ไม่รับรองหรือรับประกันว่าธุรกรรมบัญชีใด ๆ จะเป็นไปตามข้อกำหนดการให้บริการของแต่ละแพลตฟอร์มต้นทาง (Twitter/X, Meta, Google, Discord ฯลฯ) — แพลตฟอร์มเหล่านั้นสามารถระงับบัญชีตามนโยบายของตนเองได้ทุกเมื่อ โดยเป็นอิสระจาก XCheap.us',
          'หาก XCheap.us พบหรือมีเหตุอันควรเชื่อได้ว่าบัญชีที่ลงขายมีที่มาจากการยึดบัญชีโดยไม่ได้รับอนุญาต จะดำเนินการลบรายการสินค้าทันที ปฏิเสธคำขอรับประกัน/คืนเงินใด ๆ สำหรับบัญชีนั้น และอาจให้ข้อมูลแก่หน่วยงานที่เกี่ยวข้องเมื่อได้รับการร้องขอโดยชอบด้วยกฎหมาย',
        ],
      },
      {
        heading: '9. พฤติกรรมที่ต้องห้าม',
        paragraphs: [
          'ห้ามนำบัญชีหรือบริการที่ซื้อจากที่นี่ไปใช้เพื่อวัตถุประสงค์ที่ผิดกฎหมายโดยเด็ดขาด',
          'XCheap.us ไม่รับผิดชอบต่อการนำทรัพยากรไปใช้ผิดวัตถุประสงค์ใด ๆ และขอสงวนสิทธิ์ในการระงับหรือยกเลิกบัญชีที่ละเมิดโดยไม่ต้องแจ้งล่วงหน้า',
        ],
      },
      {
        heading: '10. ข้อจำกัดความรับผิดชอบ',
        paragraphs: [
          'บริการนี้ให้บริการตาม "สภาพที่เป็นอยู่" ภายในขอบเขตที่กฎหมายอนุญาต XCheap.us ไม่รับผิดชอบต่อความเสียหายทางอ้อมที่เกิดจากการใช้บัญชีดิจิทัลที่ซื้อไป นอกเหนือจากที่ครอบคลุมในนโยบายรับประกันข้อ 7',
        ],
      },
      {
        heading: '11. การเปลี่ยนแปลงข้อกำหนด',
        paragraphs: [
          'ข้อกำหนดนี้อาจได้รับการปรับปรุงตามการดำเนินงานจริงของบริการและการเปลี่ยนแปลงของกฎหมายที่เกี่ยวข้อง วันที่อัปเดตล่าสุดจะแสดงอยู่ด้านบนของหน้านี้เสมอ',
        ],
      },
      {
        heading: '12. ติดต่อเรา',
        paragraphs: [
          'หากมีข้อสงสัยเกี่ยวกับข้อกำหนดการให้บริการนี้ กรุณาติดต่อฝ่ายสนับสนุนผ่าน Telegram ได้ที่เมนู "สนับสนุน" ในเมนูบัญชีของคุณ',
        ],
      },
    ],
  },
};

export const TermsPage: React.FC<TermsPageProps> = ({ language, onBackToStore }) => {
  const content = TERMS_CONTENT[language];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <button
        onClick={onBackToStore}
        className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{language === 'vn' ? 'Về trang chủ' : language === 'zh' ? '返回首页' : language === 'th' ? 'กลับหน้าแรก' : 'Back to store'}</span>
      </button>

      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-5 sm:p-7 mb-4">
        <div className="flex items-start gap-3.5 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4.5 h-4.5" />
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
