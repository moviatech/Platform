import type { Localized } from "./content";

export type FaqItem = { id: string; q: Localized; a: Localized };

export const faq: FaqItem[] = [
  {
    id: "fsd-included",
    q: {
      zh: "真的标配 FSD（监督版）吗？",
      en: "Is FSD (Supervised) really included?",
    },
    a: {
      zh: "是的。微智驾车队的每一辆车都包含 Full Self-Driving (Supervised)，不另收费，已包含在标准租金中。",
      en: "Yes. Every vehicle in the Movia fleet includes Full Self-Driving (Supervised) at no additional charge. It is part of the standard rental rate.",
    },
  },
  {
    id: "fsd-experience",
    q: {
      zh: "我需要有使用 FSD（监督版）的经验吗？",
      en: "Do I need experience with FSD (Supervised)?",
    },
    a: {
      zh: "不需要。取车时我们会为你讲解 Full Self-Driving (Supervised)的工作方式、如何启用与退出，以及系统对驾驶员的要求。",
      en: "No prior experience is required. At pickup we walk you through how Full Self-Driving (Supervised) works, how to engage and disengage it, and what the system expects from you as the driver.",
    },
  },
  {
    id: "pickup",
    q: {
      zh: "在哪里取车？",
      en: "Where do I pick up the vehicle?",
    },
    a: {
      zh: "门店位于加州尔湾，距离约翰韦恩机场与橙县中心仅数分钟车程。可按需咨询送车服务。",
      en: "Our location is in Irvine, CA, a short drive from John Wayne Airport and central Orange County. Delivery may be available on request.",
    },
  },
  {
    id: "long-term",
    q: {
      zh: "可以租一周或更长时间吗？",
      en: "Can I rent for a week or longer?",
    },
    a: {
      zh: "可以。我们提供日租、周租与月租，租期越长越划算。长期定制方案请联系我们。",
      en: "Yes. We offer daily, weekly and monthly rates, with better value for longer rentals. Contact us for custom long-term arrangements.",
    },
  },
  {
    id: "international-license",
    q: {
      zh: "可以使用国际驾照吗？",
      en: "Can I use an international driver's license?",
    },
    a: {
      zh: "大多数情况下可以。持有本国有效驾照与护照的驾驶员通常可以租车。如驾照非英文，建议同时持有国际驾驶许可证（IDP）。最终资格在预订时确认。",
      en: "In most cases, yes. Drivers with a valid license from their home country and a passport can usually rent. An International Driving Permit is recommended if your license isn't in English. Final eligibility is confirmed at booking.",
    },
  },
  {
    id: "fsd-autonomous",
    q: {
      zh: "FSD（监督版）是完全自动驾驶吗？",
      en: "Is FSD (Supervised) fully autonomous?",
    },
    a: {
      zh: "不是。Full Self-Driving (Supervised)需要驾驶员保持专注、双手置于方向盘并随时准备接管。它不能使车辆实现自动驾驶，驾驶员始终对车辆负责。",
      en: "No. Full Self-Driving (Supervised) requires an attentive driver with hands on the wheel who is ready to take over at all times. It does not make the vehicle autonomous, and the driver remains responsible for the vehicle.",
    },
  },
  {
    id: "charging",
    q: {
      zh: "充电怎么办？",
      en: "How does charging work?",
    },
    a: {
      zh: "交车时车辆处于高电量状态。租期内可使用超级充电网络及公共充电桩。取车时我们会说明充电方式与还车电量要求。",
      en: "Your car is handed over well charged, and you can use Tesla Superchargers and public chargers during the rental. We explain charging and the return charge level at pickup.",
    },
  },
  {
    id: "delivery",
    q: {
      zh: "提供送车服务吗？",
      en: "Do you offer delivery?",
    },
    a: {
      zh: "橙县及部分洛杉矶地区可能提供付费送车服务。请提交地址与日期，我们会为你确认。",
      en: "Delivery within Orange County and select Los Angeles areas may be available for an additional fee. Send a request with your address and dates and we will confirm.",
    },
  },
  {
    id: "age",
    q: {
      zh: "租车的最低年龄是多少？",
      en: "What is the minimum age to rent?",
    },
    a: {
      zh: "承租人须年满 21 周岁、持照满 12 个月且驾驶记录良好，21–24 周岁另收年轻驾驶人附加费。如有资格疑问请联系我们。",
      en: "Renters must be at least 21, have held a license for 12 months and have a clean driving record. Drivers aged 21–24 pay a young driver surcharge. Contact us if you have questions about eligibility.",
    },
  },
  {
    id: "insurance",
    q: {
      zh: "保险如何处理？",
      en: "What about insurance?",
    },
    a: {
      zh: "通常需要提供有效的个人车险证明或符合条件的信用卡保险。预订过程中会提供补充保险选项。",
      en: "Proof of personal auto insurance or eligible credit card coverage is generally required. Optional damage waivers are offered at checkout.",
    },
  },
  {
    id: "inspection",
    q: {
      zh: "取车时需要做什么检查？",
      en: "What should I check at pickup?",
    },
    a: {
      zh: "我们会和你一起绕车检查外观、轮胎和内饰，核对电量与里程并记录在交车单上，建议你同时拍照或录一段视频留存。发现已有划痕请当场指出，我们会记录下来，还车时不会算到你头上。",
      en: "We walk around the vehicle with you to check the body, tires and interior, note the charge level and mileage on the handover form, and recommend you take photos or a short video too. Point out any existing marks and we'll record them so they're never counted against you at return.",
    },
  },
  {
    id: "after-hours-return",
    q: {
      zh: "门店关门了还能还车吗？",
      en: "Can I return the car after hours?",
    },
    a: {
      zh: "可以，请提前预约非营业时间还车（$60/次）。把车停到指定车位、锁好、按指引放好钥匙，并拍下停放位置、电量和里程。在我们下一个营业日验车前，车辆仍由你负责，所以请务必拍照留存。",
      en: "Yes, by prior arrangement ($60 per after-hours return). Park in the designated spot, lock the vehicle, leave the key as instructed and photograph the parking position, charge level and mileage. You remain responsible for the vehicle until we inspect it on the next business day, so please keep those photos.",
    },
  },
  {
    id: "warning-light",
    q: {
      zh: "仪表出现警告灯怎么办？",
      en: "What if a warning light comes on?",
    },
    a: {
      zh: "请尽快在安全的地方停车并联系我们，不要带着警告灯继续长途行驶。属于车辆本身的机械或软件故障由我们负责，会安排检修或调换同级车辆；因忽视警告灯继续驾驶造成的额外损坏由承租人承担。",
      en: "Pull over somewhere safe and contact us; please do not keep driving long distances with a warning light on. Mechanical or software faults inherent to the vehicle are on us, and we will arrange a check or swap you into an equivalent car. Additional damage caused by driving on after ignoring a warning is the renter's responsibility.",
    },
  },
  {
    id: "accident",
    q: {
      zh: "发生事故怎么处理？",
      en: "What do I do after an accident?",
    },
    a: {
      zh: "先确保人身安全，有人受伤或车辆无法移动请拨打 911。然后立即联系我们，并在 24 小时内报警取得报案编号。请拍下现场、双方车辆以及对方的驾照与保险信息，不要私下和解。我们会协助安排道路救援和后续理赔。",
      en: "Make sure everyone is safe and call 911 if anyone is hurt or the vehicle cannot be moved. Then contact us immediately and file a police report within 24 hours so you have a report number. Photograph the scene, both vehicles and the other driver's license and insurance details, and do not settle privately. We will help arrange roadside assistance and the claim.",
    },
  },
  {
    id: "credit-card",
    q: {
      zh: "对信用卡有什么要求？",
      en: "What are the credit card requirements?",
    },
    a: {
      zh: "需要承租人本人名下的信用卡（Visa、Mastercard、Amex 均可），用于押金预授权：Model Y 系列 $500，Cybertruck $1,000，请确保可用额度足够。不接受借记卡、预付卡和他人名下的卡。",
      en: "A credit card in the renter's own name (Visa, Mastercard or Amex) is required for the deposit hold: $500 for the Model Y range and $1,000 for Cybertruck, so please make sure you have enough available credit. Debit cards, prepaid cards and cards in someone else's name are not accepted.",
    },
  },
  {
    id: "senior-driver",
    q: {
      zh: "年龄较大的驾驶员可以租车吗？",
      en: "Is there an upper age limit?",
    },
    a: {
      zh: "可以，租车没有年龄上限。70 周岁及以上的驾驶员请出示有效驾照，并提供一年内医生开具的适合驾驶证明，具体以取车时的资格审核为准。",
      en: "No. Drivers aged 70 and over should present a valid license together with a physician's note dated within the past year confirming fitness to drive. Final eligibility is confirmed at pickup.",
    },
  },
  {
    id: "deposit-refund",
    q: {
      zh: "押金什么时候退？",
      en: "When is the deposit released?",
    },
    a: {
      zh: "还车验车无异常后，押金通常在 1 个工作日内发起解冻。预授权不是扣款，解冻到账时间因发卡行而异，一般 3–7 个工作日。还车后才收到的罚单或过路费会另行结算，每一项扣费我们都会提供明细。",
      en: "After a clean return inspection we release the hold, usually within one business day. A hold is not a charge, and banks take about 3–7 business days to post the release. Tickets or tolls that arrive after the return are settled separately, always with an itemized statement.",
    },
  },
  {
    id: "receipts",
    q: {
      zh: "还车后需要保留什么？",
      en: "What should I keep after the rental?",
    },
    a: {
      zh: "请保留租车协议、交车与还车单、押金预授权记录和你拍的照片至少 4 周，方便核对信用卡账单。如果账单上有不明扣费，直接联系我们，我们会逐项说明。",
      en: "Keep the rental agreement, handover and return forms, the deposit hold record and your photos for at least four weeks so you can check your card statement. If anything on it looks unfamiliar, contact us and we will go through it line by line.",
    },
  },
  {
    id: "payment-options",
    q: {
      zh: "可以先预订、取车时再付款吗？",
      en: "Can I book now and pay at pickup?",
    },
    a: {
      zh: "可以。下单时二选一：「立即付款」在线付清租金与税费，享 2% 立减；「稍后付款」现在只绑定本人名下的信用卡、不扣款，取车时再扣。两种方式取消规则相同：短租取车前 24 小时以上免费取消，月租订单需提前 72 小时；更晚取消或未到店按标价日租金折算天数扣除，详见租赁政策。押金都在取车时以信用卡预授权办理。",
      en: "Yes. Choose at checkout: pay now to settle the rental and tax online with a 2% discount, or pay later by saving a credit card in your own name now with no charge and paying at pickup. Both share the same cancellation terms: short rentals are free to cancel more than 24 hours before pickup, and monthly rentals more than 72 hours before; later cancellations and no-shows are charged in days at the listed daily rate, as set out in the rental policy. The deposit hold is placed at pickup either way.",
    },
  },
];
