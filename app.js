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

    // --- Initialization ---
    loadAssignments();
    loadTheme();

    // --- Event Listeners ---
    form.addEventListener('submit', handleAddAssignment);
    themeToggle.addEventListener('click', toggleTheme);
    accentPicker.addEventListener('input', updateAccentColor);
    gcalBtn.addEventListener('click', handleAuthClick);
    scheduleBtn.addEventListener('click', handleAutoSchedule);
    confirmDeleteBtn.addEventListener('click', handleConfirmDelete);
    cancelDeleteBtn.addEventListener('click', closeModal);


    // Initialize Google Scripts
    maybeInitGoogle();

    // --- Handlers ---

    function handleAddAssignment(e) {
        e.preventDefault();

        const title = document.getElementById('title').value;
        const subject = document.getElementById('subject').value;
        const difficulty = difficultyInput.value;
        const dueDate = dueDateInput.value;

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const inputDate = new Date(dueDate + 'T00:00:00');

        if (inputDate < now) {
            alert("Cannot add assignments with due dates in the past.");
            return;
        }

        // Handle Effort Conversion
        let effortVal = parseFloat(effortInput.value);
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
            completed: false,
            isScheduled: false
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
            // Fix timezone parsing issue by explicitly using local time parts
            const [year, month, day] = assignment.dueDate.split('-');
            const dueDate = new Date(year, month - 1, day);
            dueDate.setHours(0, 0, 0, 0);

            const diffTime = dueDate.getTime() - now.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

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
                                    <h3>${assignment.title} ${assignment.isScheduled ? '<span class="scheduled-badge" title="Scheduled in Google Tasks">✓ Scheduled</span>' : ''}</h3>
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

    async function handleConfirmDelete() {
        if (assignmentToDeleteId !== null) {
            const assignmentToDelete = assignments.find(a => a.id === assignmentToDeleteId);

            if (assignmentToDelete) {
                // If it was scheduled, try to delete from Google APIs
                if (assignmentToDelete.isScheduled && gapiInited && gisInited && gapi.client.getToken() !== null) {
                    try {
                        // 1. Delete from Tasks list if we have the ID and list ID
                        if (assignmentToDelete.googleTaskId && assignmentToDelete.googleTaskListId) {
                            await gapi.client.tasks.tasks.delete({
                                tasklist: assignmentToDelete.googleTaskListId,
                                task: assignmentToDelete.googleTaskId
                            });
                        }

                        // 2. Delete from Calendar if we have the ID
                        if (assignmentToDelete.googleEventId) {
                            await gapi.client.calendar.events.delete({
                                calendarId: 'primary',
                                eventId: assignmentToDelete.googleEventId
                            });
                        }
                    } catch (err) {
                        console.error("Failed to delete from Google APIs (it may have been deleted manually):", err);
                    }
                }

                assignments = assignments.filter(a => a.id !== assignmentToDeleteId);
                saveAssignments();
                renderAssignments();
            }
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

    // --- Theme & Accent ---

    function toggleTheme() {
        const isLight = document.body.classList.contains('light-theme');
        const isBeige = document.body.classList.contains('beige-theme');

        document.body.classList.remove('light-theme', 'beige-theme');

        let newTheme = 'dark';
        let icon = '☀️';

        if (!isLight && !isBeige) {
            // Dark -> Light
            document.body.classList.add('light-theme');
            newTheme = 'light';
            icon = '☕'; // Coffee for light, then moon for beige
        } else if (isLight) {
            // Light -> Beige
            document.body.classList.add('beige-theme');
            newTheme = 'beige';
            icon = '🌙';
        } else if (isBeige) {
            // Beige -> Dark
            newTheme = 'dark';
            icon = '☀️';
        }

        localStorage.setItem('theme', newTheme);
        themeToggle.textContent = icon;
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
            themeToggle.textContent = '☕';
        } else if (savedTheme === 'beige') {
            document.body.classList.add('beige-theme');
            themeToggle.textContent = '🌙';
        } else {
            themeToggle.textContent = '☀️';
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
            if (gapi.client.getToken() !== null) {
                gcalBtn.innerHTML = '✅ Connected';
                scheduleBtn.style.display = 'inline-block';
            }
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

            const toSchedule = assignments.filter(a => !a.completed && !a.isScheduled);

            if (toSchedule.length === 0) {
                alert("All assignments are already scheduled or completed!");
                scheduleBtn.disabled = false;
                scheduleBtn.innerText = "✨ Auto-Schedule";
                return;
            }

            let currentStartDate = new Date();
            // Start scheduling from tomorrow if tasks are due tomorrow or later, otherwise today
            currentStartDate.setHours(16, 0, 0, 0); // Default to 4 PM

            // Sort by priority to schedule the most important ones first
            toSchedule.sort((a, b) => calculatePriorityScore(b) - calculatePriorityScore(a));

            for (const task of toSchedule) {
                // Correctly offset due date to local midnight to avoid timezone shift on Google Tasks
                const localDueDate = new Date(task.dueDate + 'T23:59:59');

                // --- 1. Create Google Task ---
                const newTask = {
                    title: `📚 ${task.title} (${task.subject})`,
                    notes: `Difficulty: ${task.difficulty}\nEst. Effort: ${task.effort}h\nAdded as Calendar Event`,
                    due: localDueDate.toISOString()
                };

                const taskResponse = await gapi.client.tasks.tasks.insert({
                    tasklist: homeworkList.id,
                    resource: newTask
                });

                // Save task references for future deletion
                task.googleTaskId = taskResponse.result.id;
                task.googleTaskListId = homeworkList.id;

                // --- 2. Create Google Calendar Event ---
                // Try to schedule on the due date at 4 PM
                const eventStartDate = new Date(task.dueDate + 'T16:00:00');
                const eventEndDate = new Date(eventStartDate.getTime() + (task.effort * 60 * 60 * 1000));

                const event = {
                    'summary': `📚 ${task.title} (${task.subject})`,
                    'description': `Difficulty: ${task.difficulty}\nPriority Score: ${calculatePriorityScore(task)}`,
                    'start': {
                        'dateTime': eventStartDate.toISOString(),
                        'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    'end': {
                        'dateTime': eventEndDate.toISOString(),
                        'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    'colorId': '5' // Yellow color for homework blocks
                };

                const eventResponse = await gapi.client.calendar.events.insert({
                    'calendarId': 'primary',
                    'resource': event
                });

                // Save event reference
                task.googleEventId = eventResponse.result.id;

                // Mark this specific assignment object as scheduled
                task.isScheduled = true;
            }

            // Save state and re-render to show badges
            saveAssignments();
            renderAssignments();

            alert(`Successfully added ${toSchedule.length} tasks to your "Homework Auto-Sorter" list!`);
        } catch (err) {
            console.error("Error scheduling tasks:", err);
            alert("Failed to schedule tasks. Check console.");
        } finally {
            scheduleBtn.disabled = false;
            scheduleBtn.innerText = "✨ Auto-Schedule";
        }
    }


}); 
