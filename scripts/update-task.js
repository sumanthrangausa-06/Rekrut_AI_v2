import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = path.join(__dirname, '../../public/agent-tasks.json');
const STATUS_FILE = path.join(__dirname, '../../public/agent-status.json');

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

export function updateTaskStatus(taskId, updates) {
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

export function addTask(task) {
  const data = readTasks();
  data.tasks.push({
    ...task,
    id: task.id || `tsk-${String(data.tasks.length + 1).padStart(3, '0')}`,
    progress: task.progress || 0,
    notes: task.notes || [],
    files: task.files || []
  });
  writeTasks(data);
  console.log(`Added task ${task.id}`);
  return true;
}

export function getSubagentData() {
  try {
    const output = execSync('openclaw sessions list --active-minutes 180 --kinds subagent,acp --limit 50', {
      encoding: 'utf8',
      timeout: 10000
    });
    return { success: true, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// CLI usage
if (process.argv[2] === 'update') {
  const taskId = process.argv[3];
  const field = process.argv[4];
  const value = process.argv[5];
  
  if (!taskId || !field || !value) {
    console.log('Usage: node update-task.js update <taskId> <field> <value>');
    console.log('Example: node update-task.js update tsk-010 status done');
    process.exit(1);
  }
  
  updateTaskStatus(taskId, { [field]: value });
}

if (process.argv[2] === 'scan') {
  const data = getSubagentData();
  console.log(data);
}
