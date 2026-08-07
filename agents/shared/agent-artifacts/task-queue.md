# Task Queue
## Task 001 (ASSIGNED to AGENT-TEST-002)
- type: compute
- instruction: Calculate factorial of 5 (5!) and square of 12
- output_file: /root/.openclaw/workspace/agent-test-result-002.md
- status: COMPLETED

## Task 002 (UNASSIGNED)
- type: verify
- instruction: Check if previous task completed correctly
- depends_on: Task 001
- status: READY
