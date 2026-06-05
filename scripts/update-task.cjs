const fs = require('fs');
const path = require('path');

const TASKS_FILE = path.join(__dirname, '../public/agent-tasks.json');

function readTasks() {
  try {
    const content = fs.readFileSync(TASKS_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return { tasks: [], stats: {} };
  }
}

function writeTasks(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

function updateTaskStatus(taskId, updates) {
  const data = readTasks();
  const taskIndex = data.tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    console.error(`Task ${taskId} not found`);
    return false;
  }
  
  data.tasks[taskIndex] = { ...data.tasks[taskIndex], ...updates };
  
  // Recalculate stats
  data.stats = {
    total: data.tasks.length,
    todo: data.tasks.filter(t => t.status === 'todo').length,
    inProgress: data.tasks.filter(t => t.status === 'in-progress').length,
    review: data.tasks.filter(t => t.status === 'review').length,
    done: data.tasks.filter(t => t.status === 'done').length,
    blocked: data.tasks.filter(t => t.status === 'blocked').length,
    timeout: data.tasks.filter(t => t.status === 'timeout').length,
    critical: data.tasks.filter(t => t.priority === 'critical').length,
    high: data.tasks.filter(t => t.priority === 'high').length,
    medium: data.tasks.filter(t => t.priority === 'medium').length,
    low: data.tasks.filter(t => t.priority === 'low').length,
  };
  
  data.generated_at = new Date().toISOString();
  
  writeTasks(data);
  console.log(`Updated task ${taskId}:`, updates);
  return true;
}

// CLI usage
if (process.argv[2] === 'update') {
  const taskId = process.argv[3];
  const field = process.argv[4];
  const value = process.argv[5];
  
  if (!taskId || !field) {
    console.log('Usage: node update-task.cjs update <taskId> <field> <value>');
    console.log('Example: node update-task.cjs update tsk-010 status done');
    console.log('Fields: status, progress, priority, error');
    process.exit(1);
  }
  
  updateTaskStatus(taskId, { [field]: value });
}

module.exports = { updateTaskStatus, readTasks, writeTasks };
