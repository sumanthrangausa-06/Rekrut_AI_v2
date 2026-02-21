# Rekrut AI - Intelligent Recruitment Platform

Rekrut AI is a next-generation recruitment platform that leverages advanced AI to verify candidate skills, detect bias, and automate the hiring workflow. It features a unique "OmniScore" credit system for candidates and a "TrustScore" for companies.

## Core Features

-   **OmniScore**: A FICO-like credit score for candidates based on verified skills, interview performance, and behavioral data.
-   **TrustScore**: A reputation score for companies to ensure transparency and trust.
-   **AI Matching Engine**: Uses Vector Embeddings (`pgvector`) for semantic matching between candidates and jobs.
-   **Video Interview Analysis**: AI-driven analysis of video interviews for soft skills and technical competency.
-   **Bias Detection**: Automated auditing of hiring decisions to ensure fairness and compliance.
-   **Hybrid Architecture**: Modern React Frontend (`client/`) + Robust Node.js Backend.

## Tech Stack

-   **Frontend**: React 19, Vite, Tailwind CSS, Shadcn UI
-   **Backend**: Node.js (Express), Microservices architecture
-   **Database**: PostgreSQL with `pgvector` extension
-   **AI**: Multi-provider support (Anthropic, OpenAI, NVIDIA NIM, Groq)

## Prerequisites

-   **Node.js**: v18 or higher
-   **PostgreSQL**: v15+ (Must support `pgvector` extension)
-   **Git**

## Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/StartUp-Polsia/Rekrut_AI.git
cd Rekrut_AI
```

### 2. Backend Setup
The backend handles API requests, database interactions, and AI processing.

```bash
# Install backend dependencies
npm install

# Create environment file
cp .env.example .env  # (Or create manually, see Environment Variables below)

# Run Database Migrations
npm run migrate  # Sets up schema and pgvector
```

### 3. Frontend Setup
The frontend is a React application located in the `client/` directory.

```bash
cd client
npm install
cd ..
```

### 4. Running the Application
You can run both frontend and backend locally.

**Option A: Concurrent Run (Recommended)**
(Check `package.json` for concurrent scripts if available, otherwise run in separate terminals)

**Option B: Separate Terminals**

*Terminal 1 (Backend):*
```bash
npm run dev
# Server starts at http://localhost:3000
```

*Terminal 2 (Frontend):*
```bash
cd client
npm run dev
# App starts at http://localhost:5173
```

## Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/rekrut_ai

# Security
SESSION_SECRET=your-super-secret-key-change-this
JWT_SECRET=another-super-secret-key

# AI Providers (Required for AI features)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-...
NIM_API_KEY=nvapi-...
GROQ_API_KEY=gsk_...

# Optional
LOG_LEVEL=debug
```

## Project Structure

-   `/client`: React Frontend Application
-   `/routes`: API Route Definitions
-   `/services`: Core Business Logic (OmniScore, Matching, etc.)
-   `/lib`: Shared Utilities and Database Connections
-   `/migrations`: Database Schema Migrations
-   `/docs`: Architecture and Audit Documentation

## AI Health & Monitoring
The platform includes an Admin Dashboard to monitor AI token usage, costs, and model performance. Access it at `/admin` (requires admin role).

---
Built with ❤️ by Polsia Inc.
