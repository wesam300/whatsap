const API_URL = 'http://localhost:3000/api/reports';

let currentReportId = null;

function getApiKey() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('api_key') || '';
}

document.addEventListener('DOMContentLoaded', () => {
    // Check if API Key is present
    const apiKey = getApiKey();
    if (!apiKey) {
        console.warn('No API Key found in URL. Operations might fail.');
        // Optional: Prompt user?
    }

    setupEventListeners();
    updatePreview();
});

function setupEventListeners() {
    document.getElementById('saveBtn').addEventListener('click', saveReport);
    document.getElementById('previewBtn').addEventListener('click', updatePreview);

    document.getElementById('addFieldBtn').addEventListener('click', addDataField);
    document.getElementById('addColumnBtn').addEventListener('click', addTableColumn);
    document.getElementById('addSignatureBtn').addEventListener('click', addSignature);

    document.querySelectorAll('.close').forEach(el => {
        el.addEventListener('click', () => {
            el.closest('.modal').style.display = 'none';
        });
    });

    document.querySelectorAll('.btn-copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.dataset.target;
            const element = document.getElementById(target);

            if (element.tagName === 'INPUT') {
                element.select();
                document.execCommand('copy');
            } else {
                const text = element.textContent;
                navigator.clipboard.writeText(text);
            }

            e.target.textContent = '✓ تم النسخ';
            setTimeout(() => {
                e.target.textContent = 'نسخ';
            }, 2000);
        });
    });

    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.addEventListener('input', debounce(updatePreview, 500));
    });

    setupDynamicListeners();
}

function setupDynamicListeners() {
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove')) {
            e.target.closest('.field-item, .column-item, .signature-item').remove();
            updatePreview();
        }
    });
}

function addDataField() {
    const container = document.getElementById('dataFields');
    const div = document.createElement('div');
    div.className = 'field-item';
    div.innerHTML = `
        <input type="text" placeholder="اسم الحقل" class="field-name">
        <button class="btn-remove">×</button>
    `;
    container.appendChild(div);
}

function addTableColumn() {
    const container = document.getElementById('tableColumns');
    const div = document.createElement('div');
    div.className = 'column-item';
    div.innerHTML = `
        <input type="text" placeholder="اسم العمود" class="column-label">
        <input type="text" placeholder="field_name" class="column-field">
        <button class="btn-remove">×</button>
    `;
    container.appendChild(div);
}

function addSignature() {
    const container = document.getElementById('signatures');
    const div = document.createElement('div');
    div.className = 'signature-item';
    div.innerHTML = `
        <input type="text" placeholder="مثال: المحاسب" class="signature-name">
        <button class="btn-remove">×</button>
    `;
    container.appendChild(div);
}

function collectTemplateData() {
    const dataFields = Array.from(document.querySelectorAll('.field-name'))
        .map(input => input.value)
        .filter(v => v);

    const tableColumns = Array.from(document.querySelectorAll('.column-item'))
        .map(item => ({
            label: item.querySelector('.column-label').value,
            field: item.querySelector('.column-field').value
        }))
        .filter(col => col.label && col.field);

    const signatures = Array.from(document.querySelectorAll('.signature-name'))
        .map(input => input.value)
        .filter(v => v);

    return {
        name: document.getElementById('reportName').value || 'تقرير جديد',
        header: {
            title: document.getElementById('headerTitle').value,
            logo: document.getElementById('headerLogo').value,
            companyInfo: {
                name: document.getElementById('companyName').value,
                phone: document.getElementById('companyPhone').value,
                email: document.getElementById('companyEmail').value,
                address: document.getElementById('companyAddress').value
            }
        },
        dataSource: {
            type: 'parameters',
            fields: dataFields
        },
        table: {
            columns: tableColumns
        },
        footer: {
            notes: document.getElementById('footerNotes').value,
            qrCode: document.getElementById('footerQR').checked,
            signatures: signatures
        },
        styling: {
            primaryColor: document.getElementById('primaryColor').value,
            fontFamily: document.getElementById('fontFamily').value
        }
    };
}

async function saveReport() {
    const templateData = collectTemplateData();
    const apiKey = getApiKey();

    if (!templateData.name) {
        alert('الرجاء إدخال اسم التقرير');
        return;
    }

    if (templateData.table.columns.length === 0) {
        alert('الرجاء إضافة عمود واحد على الأقل للجدول');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/create?api_key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify(templateData)
        });

        const result = await response.json();

        if (result.success) {
            currentReportId = result.reportId;
            showSuccessModal(result, apiKey);
        } else {
            alert('فشل حفظ التقرير: ' + (result.error || 'غير مصرح'));
        }
    } catch (error) {
        alert('خطأ في الاتصال بالخادم');
        console.error(error);
    }
}

function showSuccessModal(result, apiKey) {
    const modal = document.getElementById('successModal');
    const baseUrl = window.location.origin;

    document.getElementById('reportId').value = result.reportId;
    document.getElementById('whatsappEndpoint').value = `${baseUrl}${result.whatsappEndpoint}`;
    document.getElementById('downloadLink').value = `${baseUrl}${result.downloadLink}`;

    const oracleExample = `-- إرسال عبر WhatsApp
DECLARE
  v_response CLOB;
  v_url VARCHAR2(500) := '${baseUrl}${result.whatsappEndpoint}?api_key=${apiKey || 'YOUR_API_KEY'}';
BEGIN
  -- ملاحظة: يمكنك تمرير api_key كـ param أو في header
  v_response := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
    p_url => v_url,
    p_http_method => 'POST',
    p_body => '{
      "parameters": {
        "order_no": "12345",
        "customer_name": "أحمد محمد"
      },
      "phone": "249912309788",
      "sessionId": "45"
    }'
  );
END;

-- تحميل PDF فقط
-- ${baseUrl}${result.downloadLink}?order_no=12345&api_key=${apiKey || 'YOUR_API_KEY'}`;

    document.getElementById('oracleExample').textContent = oracleExample;

    modal.style.display = 'block';
}

async function updatePreview() {
    const templateData = collectTemplateData();
    const previewContent = document.getElementById('previewContent');

    const sampleData = {
        parameters: {
            order_no: '12345',
            customer_name: 'أحمد محمد',
            phone: '+249 912 309 788',
            date: new Date().toLocaleDateString('ar-EG'),
            items: [
                { item_name: 'منتج 1', quantity: '10', price: '100', total: '1000' },
                { item_name: 'منتج 2', quantity: '5', price: '200', total: '1000' }
            ],
            total: '2000'
        }
    };

    previewContent.innerHTML = generatePreviewHTML(templateData, sampleData);
}

function generatePreviewHTML(template, data) {
    const { header, table, footer, styling } = template;
    const params = data.parameters || {};

    let html = `<div style="font-family: ${styling.fontFamily}; border: 2px solid ${styling.primaryColor}; padding: 20px; border-radius: 8px;">`;

    if (header.title || header.logo || header.companyInfo.name) {
        html += `<div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid ${styling.primaryColor}; margin-bottom: 20px;">`;

        if (header.logo) {
            html += `<img src="${header.logo}" style="max-height: 60px; margin-bottom: 10px;">`;
        }

        if (header.title) {
            html += `<h2 style="color: ${styling.primaryColor}; margin: 10px 0;">${header.title}</h2>`;
        }

        if (header.companyInfo.name) {
            html += `<div style="font-size: 12px; color: #666;">`;
            html += `<div><strong>${header.companyInfo.name}</strong></div>`;
            if (header.companyInfo.phone) html += `<div>📞 ${header.companyInfo.phone}</div>`;
            if (header.companyInfo.email) html += `<div>✉️ ${header.companyInfo.email}</div>`;
            if (header.companyInfo.address) html += `<div>📍 ${header.companyInfo.address}</div>`;
            html += `</div>`;
        }

        html += `</div>`;
    }

    if (Object.keys(params).length > 0) {
        html += `<div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">`;
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string' || typeof value === 'number') {
                html += `<div style="margin: 5px 0;"><strong>${key}:</strong> ${value}</div>`;
            }
        }
        html += `</div>`;
    }

    if (table.columns && table.columns.length > 0) {
        html += `<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">`;
        html += `<thead><tr style="background: ${styling.primaryColor}; color: white;">`;

        table.columns.forEach(col => {
            html += `<th style="padding: 10px; border: 1px solid ${styling.primaryColor};">${col.label}</th>`;
        });

        html += `</tr></thead><tbody>`;

        const items = params.items || [];
        items.forEach(item => {
            html += `<tr>`;
            table.columns.forEach(col => {
                html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item[col.field] || ''}</td>`;
            });
            html += `</tr>`;
        });

        if (params.total) {
            html += `<tr style="background: ${styling.primaryColor}; color: white; font-weight: bold;">`;
            html += `<td colspan="${table.columns.length - 1}" style="padding: 10px; border: 1px solid ${styling.primaryColor};">الإجمالي</td>`;
            html += `<td style="padding: 10px; border: 1px solid ${styling.primaryColor};">${params.total}</td>`;
            html += `</tr>`;
        }

        html += `</tbody></table>`;
    }

    if (footer.notes || footer.signatures.length > 0) {
        html += `<div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid ${styling.primaryColor};">`;

        if (footer.notes) {
            html += `<div style="text-align: center; margin: 15px 0;">${footer.notes}</div>`;
        }

        if (footer.signatures.length > 0) {
            html += `<div style="display: flex; justify-content: space-around; margin-top: 30px;">`;
            footer.signatures.forEach(sig => {
                html += `<div style="text-align: center;">
                    <div>${sig}</div>
                    <div style="border-top: 1px solid #333; margin-top: 40px; padding-top: 5px;">التوقيع</div>
                </div>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
    }

    html += `</div>`;

    return html;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
