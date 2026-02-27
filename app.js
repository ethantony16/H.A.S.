document.addEventListener('DOMContentLoaded', () => {
    console.log('Homework Planner Auto-Sorter initialized.');

    // --- DOM Elements ---
    const form = document.getElementById('assignment-form');
    const priorityList = document.getElementById('priority-list');
    const themeToggle = document.getElementById('theme-toggle');
    const accentPicker = document.getElementById('accent-picker');
    const dueDateInput = document.getElementById('dueDateInput');
    const effortInput = document.getElementById('effort');
    const effortUnit = document.getElementById('effortUnit');
    const difficultyInput = document.getElementById('difficulty');
    const gcalBtn = document.getElementById('gcal-signin-btn');
    const scheduleBtn = document.getElementById('auto-schedule-btn');
    const deleteModal = document.getElementById('delete-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete');
    const cancelDeleteBtn = document.getElementById('cancel-delete');

    // --- Preferences Elements ---
    const schoolStartInput = document.getElementById('school-start');
    const schoolEndInput = document.getElementById('school-end');
    const activitiesList = document.getElementById('activities-list');
    const activityNameInput = document.getElementById('activity-name');
    const activityStartInput = document.getElementById('activity-start');
    const activityEndInput = document.getElementById('activity-end');
    const addActivityBtn = document.getElementById('add-activity-btn');


    // --- Google Calendar Config ---
    const CLIENT_ID = CONFIG.CLIENT_ID;
    const SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks';
    let tokenClient;
    let gapiInited = false;
    let gisInited = false;

    // Set date boundaries
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // School year ends June 30th
    const currentYear = today.getFullYear();
    const schoolYearEnd = new Date(currentYear + (today.getMonth() > 5 ? 1 : 0), 5, 30);

    const formatDate = (date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    dueDateInput.min = formatDate(tomorrow);
    dueDateInput.max = formatDate(schoolYearEnd);

    // --- State ---
    let assignments = [];
    let assignmentToDeleteId = null;
    let preferences = {
        schoolHours: { start: '08:00', end: '15:00' },
        activities: []
    };

    // --- Initialization ---
    loadAssignments();
    loadPreferences();
    loadTheme();

    // --- Event Listeners ---
    form.addEventListener('submit', handleAddAssignment);
    themeToggle.addEventListener('click', toggleTheme);
    accentPicker.addEventListener('input', updateAccentColor);
    gcalBtn.addEventListener('click', handleAuthClick);
    scheduleBtn.addEventListener('click', handleAutoSchedule);
    confirmDeleteBtn.addEventListener('click', handleConfirmDelete);
    cancelDeleteBtn.addEventListener('click', closeModal);

    schoolStartInput.addEventListener('change', savePreferences);
    schoolEndInput.addEventListener('change', savePreferences);
    addActivityBtn.addEventListener('click', handleAddActivity);


    // Initialize Google Scripts
    maybeInitGoogle();

    // --- Handlers ---

    function handleAddAssignment(e) {
        e.preventDefault();

        const title = document.getElementById('title').value;
        const subject = document.getElementById('subject').value;
        const difficulty = difficultyInput.value;
        const dueDate = dueDateInput.value;

        // Handle Effort Conversion
        let effortVal = parseInt(effortInput.value);
        if (effortUnit.value === 'minutes') {
            effortVal = effortVal / 60; // Convert to hours for scoring
        }

        const newAssignment = {
            id: Date.now(),
            title,
            subject,
            dueDate,
            difficulty,
            effort: effortVal,
            completed: false
        };

        assignments.push(newAssignment);
        saveAssignments();
        renderAssignments();
        form.reset();

        // Reset defaults
        difficultyInput.value = 'Medium';
        effortUnit.value = 'hours';
    }

    // --- Core Logic ---

    function calculatePriorityScore(assignment) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const dueDate = new Date(assignment.dueDate + 'T00:00:00');
        const timeDiff = dueDate - now;
        const daysUntilDue = Math.ceil(timeDiff / (1000 * 3600 * 24));

        // Base score starts at 0, builds up based on factors
        let score = 0;

        // 1. Urgency (Days until due)
        // Closer dates = Higher score
        if (daysUntilDue < 0) score += 100; // Overdue
        else if (daysUntilDue === 0) score += 80; // Today
        else if (daysUntilDue === 1) score += 60; // Tomorrow
        else if (daysUntilDue <= 3) score += 40; // Within 3 days
        else if (daysUntilDue <= 7) score += 20; // Within a week
        else score += 5; // Later

        // 2. Difficulty
        // Harder tasks should be prioritized to start earlier? Or easier first?
        // Usually, tackle harder tasks earlier or when energy is high.
        // Let's give higher weight to harder tasks so they bubble up.
        const diffWeight = {
            'Extremely Difficult': 50,
            'Difficult': 40,
            'Medium': 30,
            'Easy': 20,
            'Extremely Easy': 10
        };
        score += (diffWeight[assignment.difficulty] || 0);

        // 3. Effort (Duration)
        // Long tasks needs more time planning, so slight boost.
        // Cap at 10 points to not overwhelm urgency.
        score += Math.min(assignment.effort * 2, 20);

        return score;
    }

    function groupAssignments(assignments) {
        const groups = {
            overdue: [],
            today: [],
            tomorrow: [],
            thisWeek: [],
            later: []
        };

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        assignments.forEach(assignment => {
            const dueDate = new Date(assignment.dueDate + 'T00:00:00');
            const diffTime = dueDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays < 0) groups.overdue.push(assignment);
            else if (diffDays === 0) groups.today.push(assignment);
            else if (diffDays === 1) groups.tomorrow.push(assignment);
            else if (diffDays <= 7) groups.thisWeek.push(assignment);
            else groups.later.push(assignment);
        });

        return groups;
    }

    function renderAssignments() {
        priorityList.innerHTML = '';

        if (assignments.length === 0) {
            priorityList.innerHTML = '<p class="empty-state">No assignments yet. Add one to get started!</p>';
            return;
        }

        const groups = groupAssignments(assignments);

        const groupTitles = {
            overdue: "Overdue 🚨",
            today: "Due Today 🔥",
            tomorrow: "Due Tomorrow 📅",
            thisWeek: "Due This Week 🗓️",
            later: "Due Later 💤"
        };

        const diffMap = {
            'Extremely Easy': '🟢',
            'Easy': '🔵',
            'Medium': '🟡',
            'Difficult': '🟠',
            'Extremely Difficult': '🔴'
        };

        for (const [key, group] of Object.entries(groups)) {
            if (group.length > 0) {
                // Sort within group by priority score
                group.sort((a, b) => calculatePriorityScore(b) - calculatePriorityScore(a));

                const groupHeader = document.createElement('div');
                groupHeader.className = 'group-header';
                groupHeader.innerHTML = `<span>${groupTitles[key]}</span>`;
                priorityList.appendChild(groupHeader);

                group.forEach(assignment => {
                    const score = calculatePriorityScore(assignment);
                    const assignmentEl = document.createElement('div');
                    assignmentEl.classList.add('assignment-item');

                    let urgencyClass = 'low-urgency';
                    if (score >= 100) urgencyClass = 'critical-urgency';
                    else if (score >= 50) urgencyClass = 'high-urgency';
                    else if (score >= 20) urgencyClass = 'medium-urgency';

                    assignmentEl.classList.add(urgencyClass);

                    const dateObj = new Date(assignment.dueDate + 'T00:00:00');
                    const dateOptions = { month: 'short', day: 'numeric' };
                    const dateStr = dateObj.toLocaleDateString(undefined, dateOptions);

                    const effortDisplay = `${parseFloat(assignment.effort.toFixed(2))}h`;
                    const diffEmoji = diffMap[assignment.difficulty] || '';

                    assignmentEl.innerHTML = `
                            <div class="assignment-content">
                                <div class="assignment-top">
                                    <h3>${assignment.title}</h3>
                                    <div class="assignment-actions">
                                        <button class="delete-btn" data-id="${assignment.id}" aria-label="Delete">&times;</button>
                                    </div>
                                </div>
                                <div class="assignment-meta">
                                    <span class="subject-badge">${assignment.subject}</span>
                                    <span title="Difficulty: ${assignment.difficulty}">${diffEmoji} ${assignment.difficulty}</span>
                                    <span>
                                        <svg class="icon-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                        ${dateStr}
                                    </span>
                                    <span>⏳ ${effortDisplay}</span>
                                </div>
                            </div>
                        `;
                    priorityList.appendChild(assignmentEl);
                });
            }
        }

        // Add event listeners for delete buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                deleteAssignment(id);
            });
        });
    }

    function deleteAssignment(id) {
        assignmentToDeleteId = id;
        deleteModal.classList.add('active');
    }

    function closeModal() {
        deleteModal.classList.remove('active');
        assignmentToDeleteId = null;
    }

    function handleConfirmDelete() {
        if (assignmentToDeleteId !== null) {
            assignments = assignments.filter(a => a.id !== assignmentToDeleteId);
            saveAssignments();
            renderAssignments();
            closeModal();
        }
    }

    function loadAssignments() {
        const stored = localStorage.getItem('assignments');
        if (stored) {
            assignments = JSON.parse(stored);
            renderAssignments();
        }
    }

    function saveAssignments() {
        localStorage.setItem('assignments', JSON.stringify(assignments));
    }

    function loadPreferences() {
        const stored = localStorage.getItem('preferences');
        if (stored) {
            preferences = JSON.parse(stored);
            schoolStartInput.value = preferences.schoolHours.start;
            schoolEndInput.value = preferences.schoolHours.end;
            renderActivities();
        }
    }

    function savePreferences() {
        preferences.schoolHours.start = schoolStartInput.value;
        preferences.schoolHours.end = schoolEndInput.value;
        localStorage.setItem('preferences', JSON.stringify(preferences));
    }

    function handleAddActivity() {
        const name = activityNameInput.value;
        const start = activityStartInput.value;
        const end = activityEndInput.value;

        // Collect selected days
        const selectedDays = Array.from(document.querySelectorAll('#activity-days input:checked')).map(cb => parseInt(cb.value));

        if (name && start && end && selectedDays.length > 0) {
            preferences.activities.push({ id: Date.now(), name, start, end, days: selectedDays });
            savePreferences();
            renderActivities();
            activityNameInput.value = '';
            activityStartInput.value = '';
            activityEndInput.value = '';
            document.querySelectorAll('#activity-days input').forEach(cb => cb.checked = false);
        } else if (selectedDays.length === 0) {
            alert("Please select at least one day for the activity.");
        }
    }

    function renderActivities() {
        activitiesList.innerHTML = '';

        const dayMap = { 0: 'Su', 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'Sa' };

        preferences.activities.forEach(activity => {
            const daysStr = (activity.days || []).map(d => dayMap[d]).join(', ');

            const div = document.createElement('div');
            div.className = 'activity-item';
            div.innerHTML = `
                <div class="activity-info">
                    <strong>${activity.name} <span class="activity-days-badge">${daysStr}</span></strong>
                    <span>${activity.start} - ${activity.end}</span>
                </div>
                <button class="remove-activity-btn" data-id="${activity.id}">&times;</button>
            `;
            activitiesList.appendChild(div);
        });

        document.querySelectorAll('.remove-activity-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                preferences.activities = preferences.activities.filter(a => a.id !== id);
                savePreferences();
                renderActivities();
            });
        });
    }

    // --- Theme & Accent ---

    function toggleTheme() {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        themeToggle.textContent = isLight ? '🌙' : '☀️';
    }

    function updateAccentColor(e) {
        const color = e.target.value;
        document.documentElement.style.setProperty('--accent-color', color);
        localStorage.setItem('accentColor', color);
    }

    function loadTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-theme');
            themeToggle.textContent = '🌙';
        }

        const savedAccent = localStorage.getItem('accentColor');
        if (savedAccent) {
            document.documentElement.style.setProperty('--accent-color', savedAccent);
            accentPicker.value = savedAccent;
        }
    }

    // --- Google Calendar Integration ---

    function maybeInitGoogle() {
        if (typeof google !== 'undefined' && typeof gapi !== 'undefined') {
            gapi.load('client', initializeGapiClient);
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: '', // defined later per request
            });
            gisInited = true;
            checkAuthButton();
        } else {
            // Retry if scripts haven't loaded yet
            setTimeout(maybeInitGoogle, 500);
        }
    }

    async function initializeGapiClient() {
        await gapi.client.init({
            discoveryDocs: [
                'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
                'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest'
            ],
        });
        gapiInited = true;
        checkAuthButton();
    }

    function checkAuthButton() {
        if (gapiInited && gisInited) {
            // Button is ready - keep its current SVG icon + text
        }
    }

    function handleAuthClick() {
        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                throw (resp);
            }
            gcalBtn.innerHTML = '✅ Connected';
            scheduleBtn.style.display = 'inline-block';
            await listUpcomingEvents();
        };

        if (gapi.client.getToken() === null) {
            // Prompt the user to select a Google Account and ask for consent to share their data
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            // Skip display of account chooser and consent dialog for an existing session.
            tokenClient.requestAccessToken({ prompt: '' });
        }
    }

    async function listUpcomingEvents() {
        // Just a test function to verify connection
        try {
            const request = {
                'calendarId': 'primary',
                'timeMin': (new Date()).toISOString(),
                'showDeleted': false,
                'singleEvents': true,
                'maxResults': 10,
                'orderBy': 'startTime',
            };
            const response = await gapi.client.calendar.events.list(request);
            console.log('Upcoming events:', response.result.items);
        } catch (err) {
            console.error(err);
        }
    }

    async function handleAutoSchedule() {
        if (!assignments.length) {
            alert("No assignments to schedule!");
            return;
        }

        scheduleBtn.disabled = true;
        scheduleBtn.innerText = "Scheduling...";

        try {
            // 1. Get or Create "Homework" Task List
            const listResponse = await gapi.client.tasks.tasklists.list();
            let homeworkList = listResponse.result.items.find(l => l.title === "Homework Auto-Sorter");

            if (!homeworkList) {
                const newList = await gapi.client.tasks.tasklists.insert({
                    resource: { title: "Homework Auto-Sorter" }
                });
                homeworkList = newList.result;
            }

            const toSchedule = assignments.filter(a => !a.completed);

            // Sort by priority to schedule the most important ones first
            toSchedule.sort((a, b) => calculatePriorityScore(b) - calculatePriorityScore(a));

            for (const task of toSchedule) {
                // Determine scheduled time
                const scheduledTime = calculateOptimalTime(task.dueDate);

                const newTask = {
                    title: `📚 ${task.title} (${task.subject})`,
                    notes: `Difficulty: ${task.difficulty}\nEst. Effort: ${task.effort}h`,
                    due: `${task.dueDate}T${scheduledTime}:00.000Z` // Simplification for demo
                };

                await gapi.client.tasks.tasks.insert({
                    tasklist: homeworkList.id,
                    resource: newTask
                });
            }

            alert(`Successfully added ${toSchedule.length} tasks to your "Homework Auto-Sorter" list!`);
        } catch (err) {
            console.error("Error scheduling tasks:", err);
            alert("Failed to schedule tasks. Check console.");
        } finally {
            scheduleBtn.disabled = false;
            scheduleBtn.innerText = "✨ Auto-Schedule";
        }
    }

    function calculateOptimalTime(dateStr) {
        const dueDate = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = dueDate.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

        // 1. Determine base available time for the day
        let availableTime = "09:00"; // Default weekend start time

        if (!isWeekend) {
            // It's a weekday, wait until school is over
            availableTime = preferences.schoolHours.end;
        }

        // 2. Find the *latest* activity that occurs on this specific day
        let latestActivityEnd = availableTime;

        preferences.activities.forEach(act => {
            // Check if this activity happens on the due date's day of week
            if (act.days && act.days.includes(dayOfWeek)) {
                if (act.end > latestActivityEnd) {
                    latestActivityEnd = act.end;
                }
            }
        });

        // 3. The earliest we can start is after school AND after all activities for the day
        return latestActivityEnd;
    }
}); 
