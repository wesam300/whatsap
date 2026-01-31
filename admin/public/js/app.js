const API_URL = 'http://localhost:3000/api';

let currentUsers = [];

document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    setupEventListeners();
    setInterval(updateUserStatuses, 5000);
});

function setupEventListeners() {
    document.getElementById('addUserBtn').addEventListener('click', () => openUserModal());
    document.getElementById('userForm').addEventListener('submit', handleUserSubmit);
    document.getElementById('cancelBtn').addEventListener('click', closeUserModal);

    document.querySelectorAll('.close').forEach(el => {
        el.addEventListener('click', (e) => {
            e.target.closest('.modal').style.display = 'none';
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
}

async function loadUsers() {
    try {
        const response = await fetch(`${API_URL}/users`);
        const data = await response.json();

        if (data.success) {
            currentUsers = data.users;
            renderUsers(data.users);
        }
    } catch (error) {
        showNotification('فشل تحميل المستخدمين', 'error');
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">لا يوجد مستخدمين</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.name}</td>
            <td>${user.phone}</td>
            <td>${user.email || '-'}</td>
            <td><span class="status status-${user.status}">${getStatusText(user.status)}</span></td>
            <td>${new Date(user.createdAt).toLocaleDateString('ar-EG')}</td>
            <td>
                <div class="actions">
                    ${user.status === 'inactive' ?
            `<button class="btn btn-success" onclick="startSession('${user.id}')">تشغيل</button>` :
            `<button class="btn btn-warning" onclick="stopSession('${user.id}')">إيقاف</button>`
        }
                    ${user.status === 'qr_ready' ?
            `<button class="btn btn-info" onclick="showQR('${user.id}')">QR</button>` : ''
        }
                    <button class="btn btn-primary" onclick="editUser('${user.id}')">تعديل</button>
                    <button class="btn btn-danger" onclick="deleteUser('${user.id}')">حذف</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function getStatusText(status) {
    const statusMap = {
        'connected': 'متصل',
        'qr_ready': 'QR جاهز',
        'inactive': 'غير نشط',
        'initializing': 'جاري التهيئة',
        'authenticated': 'تم المصادقة',
        'auth_failed': 'فشل المصادقة',
        'disconnected': 'غير متصل'
    };
    return statusMap[status] || status;
}

function openUserModal(user = null) {
    const modal = document.getElementById('userModal');
    const form = document.getElementById('userForm');
    const title = document.getElementById('modalTitle');

    if (user) {
        title.textContent = 'تعديل المستخدم';
        document.getElementById('userId').value = user.id;
        document.getElementById('userName').value = user.name;
        document.getElementById('userPhone').value = user.phone;
        document.getElementById('userEmail').value = user.email || '';
    } else {
        title.textContent = 'إضافة مستخدم جديد';
        form.reset();
    }

    modal.style.display = 'block';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

async function handleUserSubmit(e) {
    e.preventDefault();

    const userId = document.getElementById('userId').value;
    const userData = {
        name: document.getElementById('userName').value,
        phone: document.getElementById('userPhone').value,
        email: document.getElementById('userEmail').value
    };

    try {
        const url = userId ? `${API_URL}/users/${userId}` : `${API_URL}/users`;
        const method = userId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (data.success) {
            showNotification(userId ? 'تم تحديث المستخدم بنجاح' : 'تم إضافة المستخدم بنجاح', 'success');
            closeUserModal();
            loadUsers();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('حدث خطأ أثناء حفظ المستخدم', 'error');
    }
}

function editUser(userId) {
    const user = currentUsers.find(u => u.id === userId);
    if (user) {
        openUserModal(user);
    }
}

async function deleteUser(userId) {
    if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/users/${userId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('تم حذف المستخدم بنجاح', 'success');
            loadUsers();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('حدث خطأ أثناء حذف المستخدم', 'error');
    }
}

async function startSession(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/start`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('تم بدء الجلسة', 'success');
            loadUsers();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('حدث خطأ أثناء بدء الجلسة', 'error');
    }
}

async function stopSession(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/stop`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('تم إيقاف الجلسة', 'success');
            loadUsers();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('حدث خطأ أثناء إيقاف الجلسة', 'error');
    }
}

async function showQR(userId) {
    const modal = document.getElementById('qrModal');
    const container = document.getElementById('qrContainer');

    container.innerHTML = '<div class="qr-loading">جاري تحميل رمز QR...</div>';
    modal.style.display = 'block';

    try {
        const response = await fetch(`${API_URL}/users/${userId}/qr`);
        const data = await response.json();

        if (data.success) {
            const qrcode = new QRCode(container, {
                text: data.qr,
                width: 256,
                height: 256
            });
        } else {
            container.innerHTML = '<div class="qr-loading">رمز QR غير متاح</div>';
        }
    } catch (error) {
        container.innerHTML = '<div class="qr-loading">فشل تحميل رمز QR</div>';
    }
}

async function updateUserStatuses() {
    for (const user of currentUsers) {
        try {
            const response = await fetch(`${API_URL}/users/${user.id}/status`);
            const data = await response.json();

            if (data.success && data.status.status !== user.status) {
                loadUsers();
                break;
            }
        } catch (error) {
        }
    }
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';

    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}
