document.addEventListener('DOMContentLoaded', () => {
    loadSessions();
});

document.getElementById('refreshSessions').addEventListener('click', loadSessions);

function loadSessions() {
    // In a real implementation, this would fetch from /api/sessions
    // Since our server.js has /health, we can use that to check status
    // Or we can assume 'default' session for now per server.js logic

    const tbody = document.getElementById('sessionsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">جاري التحميل...</td></tr>';

    // Check default session status
    fetch('/api/sessions/default/status')
        .then(response => response.json())
        .then(data => {
            tbody.innerHTML = '';

            if (data.success) {
                const tr = document.createElement('tr');
                let statusBadge = '';
                let actions = '';

                if (data.status === 'ready') {
                    statusBadge = '<span class="status-badge connected">متصل</span>';
                    actions = '<button class="btn btn-sm" disabled>متصل</button>';
                } else if (data.status === 'waiting_qr') {
                    statusBadge = '<span class="status-badge" style="background:#fff3cd;color:#856404">انتظار QR</span>';
                    actions = `<button class="btn btn-primary btn-sm" onclick="showQR('default')">مسح QR</button>`;
                } else {
                    statusBadge = '<span class="status-badge" style="background:#f8d7da;color:#721c24">غير مهيأ</span>';
                    actions = '<button class="btn btn-sm" onclick="initSession(\'default\')">تهيئة</button>';
                }

                const user = data.info ? data.info.wid.user : '-';

                tr.innerHTML = `
                    <td>default</td>
                    <td>${statusBadge}</td>
                    <td>${user}</td>
                    <td>${actions}</td>
                `;
                tbody.appendChild(tr);

                document.getElementById('activeSessionsCount').textContent = data.status === 'ready' ? '1' : '0';
            }
        })
        .catch(error => {
            console.error('Error fetching sessions:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:red">خطأ في الاتصال بالخادم</td></tr>';
        });
}

function showQR(sessionId) {
    const modal = document.getElementById('qrModal');
    const container = document.getElementById('qrCodeContainer');

    container.innerHTML = 'جاري جلب الرمز...';
    modal.style.display = 'block';

    fetch(`/api/sessions/${sessionId}/qr`)
        .then(res => res.json())
        .then(data => {
            container.innerHTML = '';
            if (data.success && data.qr) {
                new QRCode(container, data.qr);
            } else {
                container.textContent = 'لا يوجد رمز QR متاح حالياً (قد يكون متصلاً بالفعل)';
            }
        });
}

document.querySelector('.close-modal').addEventListener('click', () => {
    document.getElementById('qrModal').style.display = 'none';
});

function initSession(sessionId) {
    // Trigger initialization (if API supported it, but our server auto-inits 'default')
    alert('الجلسة قيد التهيئة تلقائياً في الخادم...');
    loadSessions();
}
