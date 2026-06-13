// --- 공용 헬퍼 함수 ---
// 'YYYY년 MM월 DD일' 형식의 날짜 문자열을 Date 객체로 변환합니다.
function parseKoreanDate(dateStr) {
    const parts = dateStr.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일/);
    if (!parts) return null;
    return new Date(parts[1], parts[2] - 1, parts[3]);
}

// 상품명과 퍼블리셔 정보를 바탕으로 표준화된 앱/게임 이름을 반환합니다.
function getAppName(title, publisher) {
    const combinedInfo = `${title} ${publisher}`;

    for (const appName in appKeywords) {
        for (const keyword of appKeywords[appName]) {
            if (combinedInfo.includes(keyword)) {
                return appName;
            }
        }
    }
    return '기타';
}

// ISO 4217 통화 코드 → 표시용 심볼 매핑.
const CURRENCY_CODE_TO_SYMBOL = {
    'KRW': '₩', 'USD': '$', 'JPY': '¥', 'EUR': '€', 'GBP': '£',
    'CNY': '¥', 'HKD': '$', 'TWD': '$', 'AUD': '$', 'CAD': '$'
};

// 결제 금액 파싱.
// 두 가지 입력 형식을 모두 지원합니다:
//   1) 문자열 형식 (구 Google / Apple): "₩9,900", "$9.99"
//   2) 객체 형식 (최근 Google Takeout): { amountMicros: "9900000000", currencyCode: "KRW" }
function parsePrice(priceInput) {
    // 객체(신규) 형식
    if (priceInput && typeof priceInput === 'object') {
        const micros = priceInput.amountMicros ?? priceInput.priceMicros;
        if (micros !== undefined && micros !== null) {
            const amount = (parseFloat(micros) || 0) / 1e6;
            const code = priceInput.currencyCode || 'KRW';
            return { amount, currency: CURRENCY_CODE_TO_SYMBOL[code] || code };
        }
        // amount/currency 필드를 직접 갖는 형태도 방어적으로 처리
        if (priceInput.amount !== undefined) {
            return {
                amount: parseFloat(priceInput.amount) || 0,
                currency: CURRENCY_CODE_TO_SYMBOL[priceInput.currencyCode] || priceInput.currency || '₩'
            };
        }
        return { amount: 0, currency: '₩' };
    }

    // 문자열(구) 형식
    if (typeof priceInput !== 'string' || priceInput.trim() === '') {
        return { amount: 0, currency: '₩' };
    }
    const currencySymbolMatch = priceInput.match(/[₩$¥€£]/);
    const currency = currencySymbolMatch ? currencySymbolMatch[0] : '₩';
    const amount = parseFloat(priceInput.replace(/[^0-9.]/g, '')) || 0;
    return { amount, currency };
}

// --- 플랫폼별 파서 ---

/**
 * Google 결제 내역(JSON)을 파싱하여 표준화된 데이터 객체를 반환합니다.
 */
function parseGoogleData(orders) {
    const processedData = {};
    let skipped = 0;

    orders.forEach((item, idx) => {
        const order = item.orderHistory;
        if (!order || !order.lineItem || order.lineItem.length === 0) {
            skipped++;
            return;
        }

        // 가격 필드는 최신 Takeout에서 lineItem 안으로 옮겨졌을 수 있어 두 위치를 모두 시도
        const rawPrice = order.totalPrice
            ?? order.lineItem[0]?.totalPrice
            ?? order.lineItem[0]?.amount;
        const rawRefund = order.refundAmount ?? order.lineItem[0]?.refundAmount;

        const priceInfo = parsePrice(rawPrice);
        const refundInfo = parsePrice(rawRefund);
        const netPrice = priceInfo.amount - refundInfo.amount;

        if (netPrice <= 0) {
            if (rawPrice) {
                console.warn('[parseGoogleData] 가격 파싱 실패로 스킵:', { index: idx, rawPrice, parsed: priceInfo });
            }
            skipped++;
            return;
        }

        const title = order.lineItem[0].doc?.title
            || order.lineItem[0].title
            || "";
        const publisher = order.lineItem[0].doc?.documentSubtitle
            || order.lineItem[0].doc?.documentSeller
            || order.lineItem[0].publisher
            || "";

        // 날짜 필드명 변형(creationTime/orderTime/createTime/purchaseTime) 모두 시도
        const rawTime = order.creationTime
            || order.orderTime
            || order.createTime
            || order.purchaseTime
            || order.lineItem[0]?.creationTime;
        const parsedTime = rawTime ? new Date(rawTime) : null;
        if (!parsedTime || isNaN(parsedTime.getTime())) {
            console.warn('[parseGoogleData] 날짜 파싱 실패로 스킵:', { index: idx, rawTime, title });
            skipped++;
            return;
        }

        // UTC → KST(UTC+9) 변환 후 날짜 추출 (브라우저 타임존 무관하게 한국 날짜 고정)
        const kstDate = new Date(parsedTime.getTime() + 9 * 60 * 60 * 1000);
        const date = new Date(kstDate.getUTCFullYear(), kstDate.getUTCMonth(), kstDate.getUTCDate());

        const appName = getAppName(title, publisher || title);

        if (!processedData[appName]) {
            processedData[appName] = [];
        }
        processedData[appName].push({ date, title, publisher, price: netPrice, currency: priceInfo.currency, source: 'google' });
    });
    if (skipped > 0) {
        console.info(`[parseGoogleData] 총 ${skipped}건 스킵됨 (환불·파싱 실패 등). 자세한 내역은 위 경고 참조.`);
    }
    return processedData;
}

/**
 * Apple 결제 내역(HTML)을 파싱하여 표준화된 데이터 객체를 반환합니다.
 */
function parseAppleData(doc) {
    const processedData = {};
    const purchaseElements = doc.querySelectorAll('.purchase');

    purchaseElements.forEach(purchase => {
        const dateEl = purchase.querySelector('.invoice-date');
        if (!dateEl) return;

        const date = parseKoreanDate(dateEl.textContent.trim());
        if (!date) return;
        
        const itemElements = purchase.querySelectorAll('li.pli');

        itemElements.forEach(item => {
            const titleEl = item.querySelector('.pli-title div');
            const priceEl = item.querySelector('.pli-price');
            const publisherEl = item.querySelector('.pli-publisher');

            if (titleEl && priceEl) {
                const title = titleEl.getAttribute('aria-label').trim();
                let priceText = priceEl.textContent.trim();
                
                if (priceText === '무료' || !priceText) return;

                const priceInfo = parsePrice(priceText);
                const publisher = publisherEl ? publisherEl.textContent.trim() : "";
                
                const appName = getAppName(title, publisher);
                
                if (appName && priceInfo.amount > 0) {
                    if (!processedData[appName]) {
                        processedData[appName] = [];
                    }
                    processedData[appName].push({ date, title, publisher, price: priceInfo.amount, currency: priceInfo.currency, source: 'apple' });
                }
            }
        });
    });
    return processedData;
}