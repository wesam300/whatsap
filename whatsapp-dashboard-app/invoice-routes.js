const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { getPuppeteerOptions, isClientHealthy } = require('./session-manager');
const { validateApiKey, validateSessionToken, logApiRequest } = require('./api-key-manager');
const { MessageMedia } = require('whatsapp-web.js');

// متغير لتخزين مرجع activeClients
let activeClientsRef = null;

// دالة لتعيين مرجع activeClients
function setActiveClientsRef(activeClients) {
  activeClientsRef = activeClients;
}

// Middleware للتحقق من صحة API Key
function validateApiKeyMiddleware(req, res, next) {
  const apiKey = req.params.apiKey || req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'مفتاح API مطلوب',
      code: 'MISSING_API_KEY'
    });
  }

  const validation = validateApiKey(apiKey);
  if (!validation.valid) {
    return res.status(401).json({
      success: false,
      error: 'مفتاح API غير صحيح',
      code: 'INVALID_API_KEY'
    });
  }

  req.apiKeyInfo = {
    ...validation,
    apiKeyId: validation.id
  };
  next();
}

// Middleware للتحقق من صحة Session Token
function validateSessionTokenMiddleware(req, res, next) {
  const sessionToken = req.headers['x-session-token'] || req.query.session_token;

  if (!sessionToken) {
    return res.status(401).json({
      success: false,
      error: 'توكن الجلسة مطلوب',
      code: 'MISSING_SESSION_TOKEN'
    });
  }

  const validation = validateSessionToken(sessionToken);
  if (!validation.valid) {
    return res.status(401).json({
      success: false,
      error: 'توكن الجلسة غير صحيح',
      code: 'INVALID_SESSION_TOKEN'
    });
  }

  req.sessionTokenInfo = {
    ...validation,
    id: validation.id
  };
  next();
}

// دالة لتوليد HTML من بيانات JSON
function generateInvoiceHTML(invoiceData) {
  const {
    orderNo,
    orderDate,
    customerName,
    customerNameAr,
    phone,
    fullAddress,
    flag = 'UNPAID',
    items = [],
    discount = 0,
    discountAmount = 0
  } = invoiceData;

  // حساب الإجمالي
  let total = items.reduce((sum, item) => sum + (item.quant * item.price), 0);

  // حساب الخصم
  let totalAfterDiscount = total;
  if (discount > 0) {
    totalAfterDiscount = total - (total * discount / 100);
  } else if (discountAmount > 0) {
    totalAfterDiscount = total - discountAmount;
  }

  // تحديد عنوان الفاتورة والعلامة المائية
  let invoiceTitle, watermarkHtml;
  if (flag === 'PAID') {
    invoiceTitle = 'فاتـورة مبيـعات';
    watermarkHtml = '<img src="https://aryamsudan.com/wp-content/uploads/2021/10/logo.png" style="width:85%;">';
  } else {
    invoiceTitle = 'فاتـورة مبدئيـة';
    watermarkHtml = `<div style="position:relative; width:100%; height:100%;">
            <div style="position:absolute; top:50%; left:0; width:100%; height:40px; border-top: 15px dashed #f00; border-bottom: 15px dashed #f00; transform: translateY(-50%) rotate(-45deg);"></div>
            <div style="position:absolute; top:50%; left:0; width:100%; height:40px; border-top: 15px dashed #f00; border-bottom: 15px dashed #f00; transform: translateY(-50%) rotate(45deg);"></div>
        </div>`;
  }

  // إنشاء صفوف الجدول
  let itemsHtml = '';
  items.forEach((item, index) => {
    const itemTotal = (item.quant || 0) * (item.price || 0);
    itemsHtml += `
        <tr>
            <td>${index + 1}</td>
            <td style="text-align:right;">${item.partname || ''}</td>
            <td>${item.store || ''}</td>
            <td>${item.unitName || ''}</td>
            <td>${item.quant || 0}</td>
            <td>${Math.trunc(item.price || 0).toLocaleString()}</td>
            <td>${Math.trunc(itemTotal).toLocaleString()}</td>
        </tr>`;
  });

  // إضافة صف الإجمالي
  itemsHtml += `
    <tr style="font-weight:bold; background:#fff;">
        <td colspan="6" style="text-align:center;">إجمالي الفاتورة</td>
        <td>${Math.trunc(total).toLocaleString()}</td>
    </tr>`;

  if (discount > 0 || discountAmount > 0) {
    const discDisplay = discount > 0 ? `${discount}%` : '';
    const discVal = discount > 0 ? (total * discount / 100) : discountAmount;
    itemsHtml += `
        <tr style="font-weight:bold;">
            <td colspan="6" style="text-align:center;">الخصم ${discDisplay}</td>
            <td>${Math.trunc(discVal).toLocaleString()}</td>
        </tr>
        <tr style="font-weight:bold; color:#f15a24;">
            <td colspan="6" style="text-align:center;">الإجمالي بعد الخصم</td>
            <td>${Math.trunc(totalAfterDiscount).toLocaleString()}</td>
        </tr>`;
  }

  // HTML كامل للفاتورة (منسق ليتناسب مع Puppeteer)
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
        @font-face {
            font-family: 'Arial';
            src: local('Arial');
        }
        body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; }
        .invoice-container {
            background:#fff; 
            padding:20px; 
            padding-bottom: 40px; 
            max-width:800px; 
            margin:auto; 
            border:2px solid #f58220; 
            position:relative; 
            min-height:1050px; 
            display:flex; 
            flex-direction:column;
        }
        .watermark {
            position:absolute; top:0; left:0; width:100%; height:100%; 
            display:flex; justify-content:center; align-items:center; 
            opacity:0.15; z-index:0; pointer-events:none; overflow:hidden;
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #f58220; padding: 5px; text-align: center; }
        .no-border td { border: none !important; }
        .header-column { flex:1; font-size:13px; }
    </style>
</head>
<body>
<div class="invoice-container">
    <div class="watermark">${watermarkHtml}</div>
    
    <div style="flex:1 0 auto; z-index:1; position:relative;">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px;">
            <div class="header-column" style="padding-inline-end:5px;">
                <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
                    <div style="color:#f58220; width:20px; text-align:center;"><i class="fa-solid fa-phone"></i></div>
                    <div style="margin-left:5px;">+249 9123 09 788 / +249 9123 37 300</div>
                </div>
                <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
                    <div style="color:#f58220; width:20px; text-align:center;"><i class="fa-solid fa-phone"></i></div>
                    <div style="margin-left:5px;">+249 183 490 000</div>
                    <div style="color:#f58220; width:20px; text-align:center; margin-left:15px;"><i class="fa-solid fa-fax"></i></div>
                    <div style="margin-left:5px;">+249 183 464 000</div>
                </div>
                <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
                    <div style="color:#f58220; width:20px; text-align:center;"><i class="fa-solid fa-envelope"></i></div>
                    <div style="margin-left:5px;">info@aryamsudan.com</div>
                </div>
                <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
                    <div style="color:#f58220; width:20px; text-align:center;"><i class="fa-solid fa-globe"></i></div>
                    <div style="margin-left:5px;">www.aryamsudan.com</div>
                </div>
                <div style="display:flex; align-items:center; direction:ltr; white-space:nowrap;">
                    <div style="color:#f58220; width:20px; text-align:center;"><i class="fa-solid fa-location-dot"></i></div>
                    <div style="margin-left:5px;">Sudan - Khartoum - AlSajana</div>
                </div>
            </div>

            <div style="width:1px; background:#f58220; height:140px; margin:0 20px;"></div>

            <div style="flex:1; text-align:center;">
                <img src="https://aryamsudan.com/wp-content/uploads/2021/10/logo.png" style="height:100px; max-width:100%;">
            </div>
        </div>

        <div style="text-align:center; margin:20px auto; width:250px; background:#f15a24; color:#fff; font-size:20px; font-weight:bold; padding:10px 0; border-radius:25px;">
            ${invoiceTitle}
        </div>

        <div style="padding: 10px; margin: 5px; font-size:13px; display: flex; justify-content: center; align-items: center; gap: 15px; direction: rtl;">
            <div style="text-align: center; border: 1px solid #f58220; border-radius: 10px; padding: 6px 10px;">
                <span style="font-weight: bold; color: #000;">رقم الفاتورة : </span>
                <span style="color:#f15a24;">${orderNo || ''}</span>
            </div>
            <div style="text-align: center; border: 1px solid #f58220; border-radius: 10px; padding: 6px 10px;">
                <span style="font-weight: bold; color: #000;">تاريخ الفاتورة : </span>
                <span style="color:#f15a24;">${orderDate || ''}</span>
            </div>
        </div>

        <table style="width:100%; font-size:13px; margin-top:10px; border-collapse:collapse;" class="no-border">
            <tr>
                <td style="width:50%; padding:4px; text-align:right;">
                    <b>الاســـــــــم :</b> <span>${customerName || ''}</span>
                </td>
                <td style="width:50%; padding:4px; text-align:right;">
                    <span>${customerNameAr || ''}</span>
                </td>
            </tr>
            <tr>
                <td style="width:50%; padding:4px; text-align:right;">
                    <b>رقم الهاتف :</b> ${phone || ''}
                </td>
                <td style="width:50%; padding:4px; text-align:right;">
                    <b>العنوان :</b> ${fullAddress || ''}
                </td>
            </tr>
        </table>

        <table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:12px; text-align:center;">
            <thead>
                <tr style="background:#f58220; color:white;">
                    <th style="padding:5px;">رقم</th>
                    <th style="padding:5px;">اسم الصنف<br>Item Name</th>
                    <th style="padding:5px;">المخزن<br>Store</th>
                    <th style="padding:5px;">الوحدة<br>Unit</th>
                    <th style="padding:5px;">الكمية<br>Qty</th>
                    <th style="padding:5px;">السعر<br>Price</th>
                    <th style="padding:5px;">الإجمالي<br>Total</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>
    </div>

    <div style="margin-top:auto; padding-top: 17px; z-index:1; position:relative;">
        <table style="width:100%; font-size:13px; text-align:center; border-collapse: collapse;" class="no-border">
            <tr>
                <td style="width:33%; vertical-align:top;">
                    <div style="font-weight:bold;">توقيع المحاسب</div>
                    <div style="font-size:11px; color:#555;">Accountant Signature</div>
                    <div style="margin-top:20px;">....................................</div>
                </td>
                <td style="width:34%; vertical-align:top;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">خدمة العملاء</div>
                    <div dir="ltr" style="font-size:20px; font-weight:bold; color:#000;">
                        <i class="fa-brands fa-whatsapp" style="color:#25d366;"></i> 0912118777
                    </div>
                </td>
                <td style="width:33%; vertical-align:top;">
                    <div style="font-weight:bold;">ختم الشركة</div>
                    <div style="font-size:11px; color:#555;">Company Stamp</div>
                    <div style="margin-top:20px;">....................................</div>
                </td>
            </tr>
        </table>
    </div>
</div>
</body>
</html>`;
}

// دالة مساعدة لتوليد PDF من HTML
async function generatePDFFromHTML(html) {
  const puppeteer = require('puppeteer-core');
  let browser = null;

  try {
    browser = await puppeteer.launch(getPuppeteerOptions());
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Endpoint لتوليد PDF من بيانات JSON (مع API Key في الرابط)
router.post('/:apiKey/generate', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
  const startTime = Date.now();

  try {
    const invoiceData = req.body;
    const { userId, apiKeyId } = req.apiKeyInfo;

    // التحقق من البيانات المطلوبة
    if (!invoiceData.orderNo) {
      return res.status(400).json({
        success: false,
        error: 'رقم الفاتورة مطلوب (orderNo)'
      });
    }

    // توليد HTML
    const html = generateInvoiceHTML(invoiceData);

    // توليد PDF
    const pdfBuffer = await generatePDFFromHTML(html);

    const responseTime = Date.now() - startTime;

    // تسجيل الطلب
    logApiRequest(
      userId, apiKeyId, req.sessionTokenInfo.id,
      '/api/invoices/generate', 'POST', 200,
      responseTime, req.ip, req.get('User-Agent')
    );

    // إرسال PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${invoiceData.orderNo}.pdf`);
    res.send(pdfBuffer);

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logApiRequest(
      req.apiKeyInfo.userId, req.apiKeyInfo.apiKeyId, req.sessionTokenInfo?.id,
      '/api/invoices/generate', 'POST', 500,
      responseTime, req.ip, req.get('User-Agent')
    );

    console.error('خطأ في توليد PDF:', error);
    res.status(500).json({
      success: false,
      error: 'فشل توليد ملف PDF: ' + error.message
    });
  }
});

// Endpoint لتوليد وإرسال PDF عبر WhatsApp (مع API Key في الرابط)
router.post('/:apiKey/generate-and-send', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
  const startTime = Date.now();

  try {
    const { phone, invoiceData } = req.body;
    const { userId, apiKeyId } = req.apiKeyInfo;
    const { sessionId } = req.sessionTokenInfo;

    // التحقق من البيانات المطلوبة
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'رقم الهاتف مطلوب (phone)'
      });
    }

    if (!invoiceData || !invoiceData.orderNo) {
      return res.status(400).json({
        success: false,
        error: 'بيانات الفاتورة مطلوبة (invoiceData.orderNo)'
      });
    }

    // التحقق من الجلسة
    const activeClients = req.app.get('activeClients'); // Assuming activeClients is still retrieved this way
    const client = activeClients ? activeClients.get(String(sessionId)) : null;

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'جلسة الواتساب غير موجودة أو غير متصلة',
        code: 'SESSION_NOT_FOUND'
      });
    }

    const healthy = await isClientHealthy(client);
    if (!healthy) {
      return res.status(400).json({
        success: false,
        error: 'جلسة الواتساب غير نشطة',
        code: 'SESSION_NOT_READY'
      });
    }

    // توليد HTML
    const html = generateInvoiceHTML(invoiceData);

    // توليد PDF
    const pdfBuffer = await generatePDFFromHTML(html);

    // إعداد المرفق
    const { MessageMedia } = require('whatsapp-web.js');
    const media = new MessageMedia(
      'application/pdf',
      pdfBuffer.toString('base64'),
      `فاتورة_${invoiceData.orderNo}.pdf`
    );

    // إرسال الرسالة
    const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
    const result = await client.sendMessage(chatId, media, {
      caption: `فاتورة رقم: ${invoiceData.orderNo}`
    });

    const responseTime = Date.now() - startTime;

    // تسجيل الطلب
    logApiRequest(
      userId, apiKeyId, req.sessionTokenInfo.id,
      '/api/invoices/generate-and-send', 'POST', 200,
      responseTime, req.ip, req.get('User-Agent')
    );

    res.json({
      success: true,
      message: 'تم إرسال الفاتورة بنجاح',
      invoiceNo: invoiceData.orderNo,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logApiRequest(
      req.apiKeyInfo.userId, req.apiKeyInfo.apiKeyId, req.sessionTokenInfo?.id,
      '/api/invoices/generate-and-send', 'POST', 500,
      responseTime, req.ip, req.get('User-Agent')
    );

    console.error('خطأ في إرسال الفاتورة:', error);
    res.status(500).json({
      success: false,
      error: 'فشل إرسال الفاتورة: ' + error.message,
      code: 'SEND_INVOICE_FAILED'
    });
  }
});

module.exports = router;
module.exports.setActiveClientsRef = setActiveClientsRef;
