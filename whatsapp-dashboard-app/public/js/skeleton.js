// Skeleton Loading System
class SkeletonLoader {
    static card() {
        return `
            <div class="skeleton-card">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-text"></div>
                <div class="skeleton-line skeleton-text"></div>
                <div class="skeleton-line skeleton-button"></div>
            </div>
        `;
    }

    static sessionCard() {
        return `
            <div class="skeleton-card session-card">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-text"></div>
                <div class="skeleton-line skeleton-status"></div>
                <div class="skeleton-line skeleton-button"></div>
            </div>
        `;
    }

    static statsCard() {
        return `
            <div class="skeleton-card stats-card">
                <div class="skeleton-line skeleton-icon"></div>
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-number"></div>
            </div>
        `;
    }

    static table() {
        return `
            <div class="skeleton-table">
                <div class="skeleton-line skeleton-header"></div>
                <div class="skeleton-line skeleton-row"></div>
                <div class="skeleton-line skeleton-row"></div>
                <div class="skeleton-line skeleton-row"></div>
            </div>
        `;
    }

    static show(container, type = 'card', count = 3) {
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        
        if (!container) return;

        let html = '';
        for (let i = 0; i < count; i++) {
            switch(type) {
                case 'card':
                    html += this.card();
                    break;
                case 'session':
                    html += this.sessionCard();
                    break;
                case 'stats':
                    html += this.statsCard();
                    break;
                case 'table':
                    html += this.table();
                    break;
            }
        }
        
        container.innerHTML = html;
    }

    static hide(container) {
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        
        if (container) {
            const skeletons = container.querySelectorAll('.skeleton-card, .skeleton-table');
            skeletons.forEach(s => s.remove());
        }
    }
}

