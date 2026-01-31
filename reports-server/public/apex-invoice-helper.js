/**
 * دالة مساعدة لإنشاء وإرسال الفواتير من Oracle APEX
 * استخدام: استدعي generateInvoiceAndSendToWhatsApp() من PL/SQL أو JavaScript في APEX
 */

async function generateInvoiceAndSendToWhatsApp(config) {
    const {
        reportsServerUrl = 'http://localhost:3001', // رابط سيرفر التقارير
        orderNo,
        orderDate,
        customerName,
        customerNameEn = '',
        phone,
        fullAddress = '',
        flag = 'PAID', // 'PAID' or other
        items = [], // array of {partname, store, unit_name, quant, price, total}
        total = 0,
        discount = 0,
        discountAmount = 0,
        phoneNumber, // للواتساب
        caption = '' // رسالة مرفقة
    } = config;

    if (!orderNo || !items || !Array.isArray(items) || items.length === 0) {
        throw new Error('بيانات الفاتورة مطلوبة (orderNo, items)');
    }

    try {
        // استدعاء API لإنشاء الفاتورة
        const response = await fetch(`${reportsServerUrl}/api/invoice/generate-and-send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderNo,
                orderDate,
                customerName,
                customerNameEn,
                phone,
                fullAddress,
                flag,
                items,
                total,
                discount,
                discountAmount,
                phoneNumber,
                caption
            })
        });

        const result = await response.json();

        if (result.success) {
            console.log('✅ تم إنشاء وإرسال الفاتورة بنجاح:', result);
            return {
                success: true,
                html: result.html,
                reportUrl: result.reportUrl,
                message: result.message
            };
        } else {
            console.error('❌ خطأ في إنشاء الفاتورة:', result.error);
            return {
                success: false,
                error: result.error,
                html: result.html || '',
                reportUrl: result.reportUrl || ''
            };
        }
    } catch (error) {
        console.error('❌ Exception:', error);
        throw new Error('خطأ في الاتصال بسيرفر التقارير: ' + error.message);
    }
}

/**
 * دالة لإنشاء PDF من HTML وإرساله عبر الواتساب
 * تتطلب: jsPDF و html2canvas
 */
async function generatePDFAndSendToWhatsApp(config) {
    const {
        reportsServerUrl = 'http://localhost:3001',
        whatsappApiUrl = 'https://srv998477.hstgr.cloud/api',
        apiKey = '',
        sessionToken = '',
        sessionId = '',
        orderNo,
        orderDate,
        customerName,
        customerNameEn = '',
        phone,
        fullAddress = '',
        flag = 'PAID',
        items = [],
        total = 0,
        discount = 0,
        discountAmount = 0,
        phoneNumber,
        caption = ''
    } = config;

    if (!orderNo || !items || !Array.isArray(items) || items.length === 0) {
        throw new Error('بيانات الفاتورة مطلوبة (orderNo, items)');
    }

    if (!phoneNumber) {
        throw new Error('رقم الهاتف مطلوب للإرسال');
    }

    try {
        // 1) اختبار الاتصال بالجلسة قبل الإرسال
        if (apiKey) {
            try {
                const dbgRes = await fetch(`${whatsappApiUrl}/${apiKey}/debug-sessions`, { 
                    method: 'GET' 
                });
                if (dbgRes.ok) {
                    const dbg = await dbgRes.json();
                    const active = Array.isArray(dbg.activeSessions) ? dbg.activeSessions : [];
                    const target = active.find(s => String(s.sessionId) === String(sessionId));
                    if (!target) {
                        throw new Error('الجلسة غير نشطة حالياً. الرجاء تشغيلها أولاً.');
                    }
                    console.log(`✅ Session ${sessionId} state:`, target.state);
                }
            } catch (e) {
                console.warn('تحذير: تعذر فحص حالة الجلسة:', e.message);
            }
        }

        // 2) إنشاء HTML الفاتورة
        const invoiceResult = await generateInvoiceAndSendToWhatsApp({
            reportsServerUrl,
            orderNo,
            orderDate,
            customerName,
            customerNameEn,
            phone,
            fullAddress,
            flag,
            items,
            total,
            discount,
            discountAmount,
            phoneNumber: null, // لا نرسل الآن، سنرسل PDF
            caption
        });

        if (!invoiceResult.success) {
            throw new Error(invoiceResult.error || 'فشل في إنشاء الفاتورة');
        }

        // 3) إنشاء عنصر مؤقت للمحتوى
        const element = document.createElement('div');
        element.innerHTML = invoiceResult.html;
        element.style.width = '210mm';
        element.style.position = 'absolute';
        element.style.left = '-9999px';
        document.body.appendChild(element);

        try {
            // 4) إنشاء PDF
            if (typeof jsPDF === 'undefined' || typeof html2canvas === 'undefined') {
                throw new Error('jsPDF و html2canvas مطلوبان. يرجى إضافتهما إلى الصفحة.');
            }

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            const canvas = await html2canvas(element, { 
                scale: 2, 
                useCORS: true,
                logging: false
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const imgProps = pdf.getImageProperties(imgData);
            const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

            let position = 0;
            while (position < imgHeight) {
                pdf.addImage(imgData, 'JPEG', 0, -position, pdfWidth, imgHeight);
                position += pdfHeight;
                if (position < imgHeight) pdf.addPage();
            }

            const pdfBlob = pdf.output('blob');

            // 5) تجهيز البيانات للإرسال
            const toNumber = String(phoneNumber).replace(/[^\d]/g, '');
            const form = new FormData();
            form.append('to', toNumber);
            form.append('caption', caption || `فاتورة مبيعات رقم: ${orderNo}\nبتاريخ: ${orderDate || ''}\n\nمع تحيات شركة أريام`);
            form.append('media', pdfBlob, `فاتورة_${orderNo}.pdf`);

            // 6) الإرسال
            const headers = {};
            if (apiKey) {
                // استخدام API Key في URL
                const response = await fetch(`${whatsappApiUrl}/${apiKey}/send-media`, {
                    method: 'POST',
                    headers: { 
                        'x-session-token': sessionToken 
                    },
                    body: form
                });

                if (!response.ok) {
                    const txt = await response.text().catch(() => '');
                    throw new Error(`فشل الإرسال: ${response.status} - ${txt}`);
                }

                const result = await response.json();
                console.log('📤 تم إرسال الملف عبر WhatsApp:', result);
                return {
                    success: true,
                    message: 'تم إرسال الفاتورة عبر WhatsApp',
                    html: invoiceResult.html,
                    reportUrl: invoiceResult.reportUrl
                };
            } else if (sessionToken) {
                // استخدام Session Token فقط
                const response = await fetch(`${whatsappApiUrl}/send-media`, {
                    method: 'POST',
                    headers: { 
                        'x-session-token': sessionToken 
                    },
                    body: form
                });

                if (!response.ok) {
                    const txt = await response.text().catch(() => '');
                    throw new Error(`فشل الإرسال: ${response.status} - ${txt}`);
                }

                const result = await response.json();
                console.log('📤 تم إرسال الملف عبر WhatsApp:', result);
                return {
                    success: true,
                    message: 'تم إرسال الفاتورة عبر WhatsApp',
                    html: invoiceResult.html,
                    reportUrl: invoiceResult.reportUrl
                };
            } else {
                throw new Error('API Key أو Session Token مطلوب');
            }
        } finally {
            document.body.removeChild(element);
        }
    } catch (error) {
        console.error('❌ Exception:', error);
        throw error;
    }
}

// تصدير الدوال للاستخدام العام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateInvoiceAndSendToWhatsApp,
        generatePDFAndSendToWhatsApp
    };
}

