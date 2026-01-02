document.addEventListener('DOMContentLoaded', function() {
    // --- 1. CẤU HÌNH & TRẠNG THÁI ---
    const CONFIG = {
        URL: "https://script.google.com/macros/s/AKfycbw4zJurshyGfu06msH72z-juBzpZXbQhG6WhtU3xkZMblnRLJPiy5qZGZw5ovg6grys/exec",
        NODES: ['A101', 'B202', 'C303', 'D404'],
        INTERVAL: 10000, 
        CHART_INTERVAL: 1800000, 
        // Lấy ngưỡng từ localStorage, nếu chưa có thì dùng mặc định
        THRESHOLD: JSON.parse(localStorage.getItem('rimuru_thresholds')) || { temp: 45, gas: 500, pm25: 100 },
        TIME_LIMITS: JSON.parse(localStorage.getItem('rimuru_time_limits')) || { online: 5, offline: 60 }
    };
    // Quản lý trạng thái hiện tại của Dashboard
    let STATE = {
        mainNode: localStorage.getItem('main_node') || 'A101', // Lưu node đang chọn vào trình duyệt
        activeMetric: localStorage.getItem('active_metric') || 'temp', // Lưu thông số đang chọn
        metricLabels: {
            temp: 'Nhiệt độ (°C)',
            humid: 'Độ ẩm (%)',
            pm25: 'Bụi PM2.5 (µg/m³)',
            gas: 'Khí Gas (ppm)'
        },
        metricColors: {
            temp: '#ff6384',
            humid: '#36a2eb',
            pm25: '#ff9f40',
            gas: '#4bc0c0'
        }
    };

    let dataLogAll = {}; 
    let alertHistory = JSON.parse(localStorage.getItem('rimuru_alerts')) || [];

    // --- 2. XỬ LÝ ĐIỀU KHIỂN CÀI ĐẶT (MỚI) ---
    const nodeSelect = document.getElementById('node-select');
    const metricSelect = document.getElementById('metric-select');

    // Thiết lập giá trị mặc định cho dropdown từ STATE
    if (nodeSelect) nodeSelect.value = STATE.mainNode;
    if (metricSelect) metricSelect.value = STATE.activeMetric;

    // Hàm thay đổi Node chính
    window.updateMainNode = function(newNode) {
        STATE.mainNode = newNode;
        localStorage.setItem('main_node', newNode);
        console.log(`📍 Đã chuyển sang Node: ${newNode}`);
        updateData();    // Cập nhật số liệu realtime ngay
        loadAnalytics(); // Tải lại biểu đồ ngay
    };

    // Hàm thay đổi thông số biểu đồ
    window.updateChartMetric = function(newMetric) {
        STATE.activeMetric = newMetric;
        localStorage.setItem('active_metric', newMetric);
        console.log(`📊 Đang hiển thị biểu đồ theo: ${STATE.metricLabels[newMetric]}`);
        loadAnalytics(); // Vẽ lại biểu đồ theo thông số mới
    };

    // --- 3. XỬ LÝ THỜI GIAN ---
    function parseTime(str) {
        if (!str || typeof str !== 'string') return new Date(NaN);
        try {
            // Cắt chuỗi "09:27:55 30/12/2025"
            const [time, date] = str.trim().split(' ');
            const [h, m, s] = time.split(':');
            const [D, M, Y] = date.split('/');
            // Lưu ý: Tháng trong JS bắt đầu từ 0 nên phải (M - 1)
            return new Date(Y, M - 1, D, h, m, s);
        } catch (e) { 
            return new Date(NaN); 
        }
    }

    // --- 4. GỌI API DỮ LIỆU REALTIME ---
    async function updateData() {
        const statusEl = document.getElementById('data-status');
        if (statusEl) statusEl.innerText = "🟡 Đang cập nhật...";

        try {
            const promises = CONFIG.NODES.map(node => 
                fetch(`${CONFIG.URL}?location=${node}`).then(res => res.json())
            );
            const results = await Promise.all(promises);

            results.forEach((res, i) => {
                if (res.result === "success") dataLogAll[CONFIG.NODES[i]] = res.data;
            });

            processAlerts();
            renderUI();
            if (statusEl) statusEl.innerText = `🟢 Cập nhật: ${new Date().toLocaleTimeString()} (Node: ${STATE.mainNode})`;
        } catch (err) {
            if (statusEl) statusEl.innerText = "🔴 Lỗi kết nối API";
            console.error(err);
        }
    }

    // --- 5. GỌI API THỐNG KÊ (BIỂU ĐỒ) ---
    async function loadAnalytics() {
        console.log(`📊 Đang lấy dữ liệu ${STATE.activeMetric} từ Node ${STATE.mainNode}...`);
        try {
            const response = await fetch(`${CONFIG.URL}?location=${STATE.mainNode}&action=stats`);
            const stats = await response.json();

            if (stats.result === "success") {
                const metric = STATE.activeMetric;
                const label = STATE.metricLabels[metric];
                const color = STATE.metricColors[metric];

                // Ánh xạ dữ liệu dựa trên metric người dùng chọn
                const weeklyFormatted = stats.weekly.map(d => ({ label: d.label, val: d[metric] }));
                const yearlyFormatted = stats.yearly.map(d => ({ label: d.label, val: d[metric] }));

                drawChart('weekly-chart-canvas', 'bar', weeklyFormatted, `${label} Tuần`, color);
                drawChart('yearly-chart-canvas', 'line', yearlyFormatted, `${label} Năm`, color);
                
                if (document.getElementById('sum-total-events')) 
                    document.getElementById('sum-total-events').innerText = stats.totalEvents;
            }
        } catch (err) {
            console.error("❌ Lỗi tải biểu đồ:", err);
        }
    }

    function drawChart(canvasId, type, data, label, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        if (!data || !Array.isArray(data) || data.length === 0) {
            if (window[canvasId] instanceof Chart) window[canvasId].destroy();
            return; 
        }
        const ctx = canvas.getContext('2d');
        if (window[canvasId] instanceof Chart) window[canvasId].destroy();

        window[canvasId] = new Chart(ctx, {
            type: type,
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    label: label,
                    data: data.map(d => d.val),
                    backgroundColor: type === 'bar' ? color + '80' : color + '20',
                    borderColor: color,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top' } }
            }
        });
    }

    // --- 6. LOGIC CẢNH BÁO ---
    function processAlerts() {
        const mainData = dataLogAll[STATE.mainNode] || [];
        mainData.forEach(r => {
            const check = (key, val, limit, label) => {
                const v = parseFloat(val);
                if (v > limit) {
                    const id = `${r.timestamp}-${key}`;
                    if (!alertHistory.find(a => a.id === id)) {
                        alertHistory.unshift({
                            id, time: r.timestamp, device: STATE.mainNode,
                            type: label, val: v, status: 'Chưa xử lý'
                        });
                    }
                }
            };
            check('temp', r.temp, CONFIG.THRESHOLD.temp, 'Nhiệt độ cao');
            check('gas', r.gas, CONFIG.THRESHOLD.gas, 'Rò rỉ khí Gas');
            check('pm25', r.pm25, CONFIG.THRESHOLD.pm25, 'Bụi PM2.5 cao');
        });
        localStorage.setItem('rimuru_alerts', JSON.stringify(alertHistory));
    }

    // --- 7. HIỂN THỊ GIAO DIỆN ---
    function renderUI() {
        const mainNodeData = dataLogAll[STATE.mainNode] || [];
        const latest = mainNodeData[mainNodeData.length - 1];
    
        const nodeDisplay = document.getElementById('current-node-display');
        if (nodeDisplay) nodeDisplay.innerText = `Node ${STATE.mainNode}`;
    
        if (latest) {
            updateText('.temperature .value', `${latest.temp} °C`);
            updateText('.humidity .value', `${latest.humid}%`);
            updateText('.gas .value', `${latest.gas} ppm`);
            updateText('.dust .value', `${latest.pm25} mg/m³`);
        }
    
        // --- ĐOẠN CẦN SỬA: ĐẾM THIẾT BỊ ONLINE ---
        let onlineCount = 0;
        const now = new Date();
        const onlineThresholdMs = CONFIG.TIME_LIMITS.online * 60 * 1000; // Đổi phút sang miligiây
    
        CONFIG.NODES.forEach(node => {
            const logs = dataLogAll[node] || [];
            if (logs.length > 0) {
                const lastTime = parseTime(logs[logs.length - 1].timestamp);
                // Nếu khoảng cách thời gian nhỏ hơn hoặc bằng ngưỡng Online đã cài đặt
                if (now - lastTime <= onlineThresholdMs) {
                    onlineCount++;
                }
            }
        });
        
        // Hiển thị số lượng Online / Tổng số Node (ví dụ: 2 / 4)
        updateText('.online-devices .value', `${onlineCount} / ${CONFIG.NODES.length}`);
        // -----------------------------------------
    
        const activeAlerts = alertHistory.filter(a => a.status === 'Chưa xử lý').length;
        updateText('.alerts-status .value', `${activeAlerts} Cảnh báo`);
        
        if (document.getElementById('sum-critical-alerts')) 
            document.getElementById('sum-critical-alerts').innerText = activeAlerts;
    
        renderMonitoringTable();
        renderAlertsTable();
    }

    function updateText(selector, val) {
        const el = document.querySelector(selector);
        if (el) el.innerText = val;
    }
    // Hàm lọc dữ liệu và hiển thị lên bảng
    window.filterData = async function() {
        const startDate = document.getElementById('query-start-date').value;
        const endDate = document.getElementById('query-end-date').value;
        const node = document.getElementById('query-node-select').value;
        
        if (!startDate || !endDate) {
            alert("Vui lòng chọn khoảng ngày!");
            return;
        }
    
        const tbody = document.querySelector('#query-result-table tbody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">⌛ Đang tải dữ liệu lịch sử...</td></tr>';
    
        try {
            // THÊM &action=all VÀO LINK FETCH
            const response = await fetch(`${CONFIG.URL}?location=${node}&action=all`); 
            const result = await response.json();
    
            if (result.result === "success") {
                const start = new Date(startDate).setHours(0,0,0,0);
                const end = new Date(endDate).setHours(23,59,59,999);
    
                const filtered = result.data.filter(log => {
                    const logDate = parseTime(log.timestamp).getTime();
                    return logDate >= start && logDate <= end;
                });
    
                tbody.innerHTML = ''; 
    
                if (filtered.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Không tìm thấy dữ liệu</td></tr>';
                    return;
                }
    
                // Đảo ngược để hiện ngày mới nhất lên đầu
                filtered.reverse().forEach(log => {
                    tbody.innerHTML += `
                        <tr>
                            <td>${log.timestamp}</td>
                            <td>${log.temp}</td>
                            <td>${log.humid}</td>
                            <td>${log.gas}</td>
                            <td>${log.pm25}</td>
                        </tr>`;
                });
            }
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">❌ Lỗi kết nối server</td></tr>';
        }
    };

    // Hàm xuất Excel từ dữ liệu đã lọc
    window.exportToExcel = function() {
        const table = document.getElementById("query-result-table");
        const node = document.getElementById('query-node-select').value;
        const wb = XLSX.utils.table_to_book(table, { sheet: "Báo cáo " + node });
        XLSX.writeFile(wb, `BaoCao_${node}_${new Date().toLocaleDateString()}.xlsx`);
    };
    function renderMonitoringTable() {
        const tbody = document.querySelector('#monitoring .data-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
    
        const now = new Date(); // Lấy thời gian hiện tại của máy tính
    
        CONFIG.NODES.forEach(node => {
            const logs = dataLogAll[node] || [];
            const lastRecord = logs[logs.length - 1];
            
            // Cấu hình mặc định khi không có dữ liệu
            let statusText = 'Mất kết nối';
            let statusColor = '#dc3545'; // Đỏ
            let displayVals = { temp: '-', humid: '-', gas: '-', pm25: '-' };
    

            if (lastRecord) {
                const lastTime = parseTime(lastRecord.timestamp);
                const diffInMinutes = (now - lastTime) / (1000 * 60);
                displayVals = lastRecord;

                // SỬ DỤNG BIẾN TÙY CHỈNH TỪ CÀI ĐẶT
                const onlineLimit = CONFIG.TIME_LIMITS.online;  // Mặc định là 5
                const offlineLimit = CONFIG.TIME_LIMITS.offline; // Mặc định là 60

                if (diffInMinutes <= onlineLimit) { 
                    statusText = 'Hoạt động';
                    statusColor = '#28a745';
                } else if (diffInMinutes <= offlineLimit) {
                    statusText = `Ngoại tuyến (${Math.round(diffInMinutes)}p trước)`;
                    statusColor = '#ff9f40';
                } else {
                    statusText = 'Mất kết nối';
                    statusColor = '#dc3545';
                }
            }
    
            // Tạo dòng cho bảng (Giữ nguyên dấu ⭐ cho Node chính)
            const rowHTML = `
                <tr>
                    <td>Node ${node} ${node === STATE.mainNode ? '⭐' : ''}</td>
                    <td>${displayVals.temp}</td>
                    <td>${displayVals.humid}</td>
                    <td>${displayVals.gas}</td>
                    <td>${displayVals.pm25}</td>
                    <td style="color:${statusColor}; font-weight:bold">
                        ${statusText}
                    </td>
                </tr>`;
            
            tbody.innerHTML += rowHTML;
        });
    }
    let full30DayData = {}; // Lưu trữ dữ liệu tạm thời

    window.load30DayStats = async function() {
        const grid = document.getElementById('charts-grid');
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center;">⌛ Đang phân tích dữ liệu 30 ngày cho tất cả Node...</p>';
        
        try {
            const promises = CONFIG.NODES.map(node => 
                fetch(`${CONFIG.URL}?location=${node}&action=30days`).then(res => res.json())
            );
            const results = await Promise.all(promises);
            
            results.forEach((res, i) => {
                if (res.result === "success") full30DayData[CONFIG.NODES[i]] = res.data;
            });

            renderAllNodesChart(document.getElementById('stats-metric-select').value);
        } catch (err) {
            grid.innerHTML = '<p style="color:red;">❌ Lỗi khi tải dữ liệu thống kê.</p>';
        }
    };

    window.renderAllNodesChart = function(metric) {
        const grid = document.getElementById('charts-grid');
        grid.innerHTML = ''; // Xóa cũ
        const labels = { temp: 'Nhiệt độ', humid: 'Độ ẩm', pm25: 'Bụi PM2.5', gas: 'Khí Gas' };
        const colors = { temp: '#ff6384', humid: '#36a2eb', pm25: '#ff9f40', gas: '#4bc0c0' };

        CONFIG.NODES.forEach(node => {
            const nodeData = full30DayData[node] || [];
            if (nodeData.length === 0) return;

            const card = document.createElement('div');
            card.className = 'report-box';
            card.innerHTML = `
                <h3>Node ${node} - ${labels[metric]} (30 ngày)</h3>
                <div style="height: 300px;"><canvas id="chart-30d-${node}"></canvas></div>
            `;
            grid.appendChild(card);

            const ctx = document.getElementById(`chart-30d-${node}`).getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: nodeData.map(d => d.label),
                    datasets: [{
                        label: labels[metric],
                        data: nodeData.map(d => d[metric]),
                        borderColor: colors[metric],
                        backgroundColor: colors[metric] + '20',
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        });
    };
    window.updateTimeConfig = function(type, value) {
        const val = parseInt(value);
        if (isNaN(val) || val <= 0) return;
    
        CONFIG.TIME_LIMITS[type] = val;
        localStorage.setItem('rimuru_time_limits', JSON.stringify(CONFIG.TIME_LIMITS));
        renderMonitoringTable(); // Cập nhật lại bảng ngay lập tức để thấy thay đổi
    };

    function renderAlertsTable() {
        const tbody = document.querySelector('#alerts .data-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        alertHistory.slice(0, 15).forEach(a => {
            const isNew = a.status === 'Chưa xử lý';
            tbody.innerHTML += `
                <tr class="${isNew ? 'alert-critical' : 'alert-resolved'}">
                    <td>${a.time}</td><td>${a.device}</td><td>${a.type}</td><td>${a.val}</td>
                    <td>${a.status}</td>
                    <td>${isNew ? `<button class="btn-primary" onclick="confirmAlert('${a.id}')">Xác nhận</button>` : '✅'}</td>
                </tr>`;
        });
    }

    window.confirmAlert = (id) => {
        const idx = alertHistory.findIndex(a => a.id === id);
        if (idx !== -1) {
            alertHistory[idx].status = 'Đã xử lý';
            localStorage.setItem('rimuru_alerts', JSON.stringify(alertHistory));
            renderUI();
        }
    };
    // -------8. cập nhật ngưỡng
    window.updateThreshold = function(key, value) {
        const val = parseFloat(value);
        if (isNaN(val)) return;
    
        CONFIG.THRESHOLD[key] = val;
        localStorage.setItem('rimuru_thresholds', JSON.stringify(CONFIG.THRESHOLD));
        console.log(`⚠️ Đã cập nhật ngưỡng ${key}: ${val}`);
        
        // Chạy lại kiểm tra cảnh báo ngay lập tức
        processAlerts();
    };
    
    // Hiển thị giá trị cũ lên ô nhập khi tải trang
    function initializeInputs() {
        if(document.getElementById('threshold-temp')) 
            document.getElementById('threshold-temp').value = CONFIG.THRESHOLD.temp;
        if(document.getElementById('threshold-gas')) 
            document.getElementById('threshold-gas').value = CONFIG.THRESHOLD.gas;
        if(document.getElementById('threshold-pm25')) 
            document.getElementById('threshold-pm25').value = CONFIG.THRESHOLD.pm25;
        if(document.getElementById('time-online-limit')) 
            document.getElementById('time-online-limit').value = CONFIG.TIME_LIMITS.online;
        if(document.getElementById('time-offline-limit')) 
            document.getElementById('time-offline-limit').value = CONFIG.TIME_LIMITS.offline;
    }

    // --- 9. KHỞI CHẠY HỆ THỐNG ---
    initializeInputs(); // Gọi hàm này để điền số vào ô input ngay lập tức
    updateData(); 
    setInterval(updateData, CONFIG.INTERVAL); 
    loadAnalytics(); 
    setInterval(loadAnalytics, CONFIG.CHART_INTERVAL);

    // Tab switching logic (giữ nguyên)
    document.querySelectorAll('.nav-link').forEach(btn => {
        btn.onclick = function(e) {
            e.preventDefault();
            document.querySelectorAll('.nav-link, .tab-content').forEach(el => el.classList.remove('active', 'active-tab'));
            this.classList.add('active');
            const target = document.getElementById(this.dataset.target);
            if (target) target.classList.add('active-tab');
        };
    });
});