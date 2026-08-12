describe("Candidate Core Journey - End to End", () => {
  const TEST_USER = {
    email: `test-${Date.now()}@rekrut.ai`,
    password: "TestPass123!",
    firstName: "Test",
    lastName: "Candidate",
    phone: "+91-9876543210",
    location: "Bangalore, India",
    skills: ["JavaScript", "React", "Node.js", "Python"],
  };

  const TEST_JOB = {
    title: "Senior Frontend Engineer",
    company: "TechCorp India",
    location: "Bangalore",
    salary: "₹25-40 LPA",
    skills: ["React", "TypeScript", "Node.js"],
  };

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it("P0-001: User can sign up and create account", () => {
    cy.visit("/signup");
    cy.get('[data-testid="signup-form"]').should("be.visible");
    cy.get('[data-testid="email-input"]').type(TEST_USER.email);
    cy.get('[data-testid="password-input"]').type(TEST_USER.password);
    cy.get('[data-testid="confirm-password-input"]').type(TEST_USER.password);
    cy.get('[data-testid="role-selector"]').select("candidate");
    cy.get('[data-testid="signup-submit"]').click();
    
    cy.url().should("include", "/onboarding");
    cy.get('[data-testid="onboarding-welcome"]').should("contain", "Welcome");
  });

  it("P0-002: User can complete onboarding and build profile", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/onboarding");
    
    // Step 1: General Info
    cy.get('[data-testid="first-name"]').type(TEST_USER.firstName);
    cy.get('[data-testid="last-name"]').type(TEST_USER.lastName);
    cy.get('[data-testid="phone"]').type(TEST_USER.phone);
    cy.get('[data-testid="location"]').type(TEST_USER.location);
    cy.get('[data-testid="next-step"]').click();
    
    // Step 2: Skills
    TEST_USER.skills.forEach((skill) => {
      cy.get('[data-testid="skill-input"]').type(skill);
      cy.get('[data-testid="add-skill"]').click();
    });
    cy.get('[data-testid="skill-tag"]').should("have.length", 4);
    cy.get('[data-testid="next-step"]').click();
    
    // Step 3: Experience (skip for now)
    cy.get('[data-testid="skip-step"]').click();
    
    // Step 4: Education (skip for now)
    cy.get('[data-testid="skip-step"]').click();
    
    // Completion
    cy.get('[data-testid="profile-complete"]').should("be.visible");
    cy.get('[data-testid="profile-score"]').should("contain", "Profile Score");
  });

  it("P0-003: User can search and browse jobs", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/jobs");
    
    cy.get('[data-testid="job-search-input"]').should("be.visible");
    cy.get('[data-testid="job-search-input"]').type("frontend");
    cy.get('[data-testid="search-button"]').click();
    
    cy.get('[data-testid="job-card"]').should("have.length.at.least", 1);
    cy.get('[data-testid="job-card"]').first().should("contain", "Frontend");
    
    // Test filters
    cy.get('[data-testid="filter-location"]').type("Bangalore");
    cy.get('[data-testid="apply-filters"]').click();
    cy.get('[data-testid="job-card"]').should("have.length.at.least", 1);
    
    // Test semantic search
    cy.get('[data-testid="job-search-input"]').clear().type("react javascript");
    cy.get('[data-testid="search-button"]').click();
    cy.get('[data-testid="job-card"]').should("have.length.at.least", 1);
  });

  it("P0-004: User can view job details and match score", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/jobs");
    
    cy.get('[data-testid="job-card"]').first().click();
    cy.url().should("include", "/job/");
    
    cy.get('[data-testid="job-detail-title"]').should("be.visible");
    cy.get('[data-testid="match-score"]').should("be.visible");
    cy.get('[data-testid="match-score"]').invoke("text").then((score) => {
      const matchScore = parseInt(score.replace(/\D/g, ""));
      expect(matchScore).to.be.at.least(0);
      expect(matchScore).to.be.at.most(100);
    });
    
    cy.get('[data-testid="skill-match-list"]').should("be.visible");
    cy.get('[data-testid="apply-button"]').should("be.visible");
  });

  it("P0-005: User can apply to a job", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/jobs");
    
    cy.get('[data-testid="job-card"]').first().click();
    cy.get('[data-testid="apply-button"]').click();
    
    cy.get('[data-testid="apply-modal"]').should("be.visible");
    cy.get('[data-testid="cover-letter"]').type("I am excited about this opportunity and believe my skills match the requirements.");
    cy.get('[data-testid="submit-application"]').click();
    
    cy.get('[data-testid="success-message"]').should("contain", "Application submitted");
    cy.get('[data-testid="application-status"]').should("contain", "Applied");
  });

  it("P0-006: User can view application status", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/applications");
    
    cy.get('[data-testid="applications-list"]').should("be.visible");
    cy.get('[data-testid="application-item"]').should("have.length.at.least", 1);
    cy.get('[data-testid="application-status"]').first().should("contain", "Applied");
  });

  it("P0-007: User can access AI Interview (Quick Practice)", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/ai-interview");
    
    cy.get('[data-testid="interview-setup"]').should("be.visible");
    cy.get('[data-testid="practice-mode"]').click();
    cy.get('[data-testid="job-role-select"]').select("Frontend Engineer");
    cy.get('[data-testid="start-interview"]').click();
    
    cy.get('[data-testid="interview-camera"]').should("be.visible");
    cy.get('[data-testid="interview-chat"]').should("be.visible");
    
    // Complete interview (mock for testing)
    cy.get('[data-testid="end-interview"]').click();
    cy.get('[data-testid="results-page"]').should("be.visible");
    cy.get('[data-testid="score-breakdown"]').should("be.visible");
  });

  it("P0-008: User can edit profile", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/profile/edit");
    
    cy.get('[data-testid="profile-edit-form"]').should("be.visible");
    cy.get('[data-testid="about-me"]').clear().type("Passionate frontend engineer with 5 years of experience.");
    cy.get('[data-testid="save-profile"]').click();
    
    cy.get('[data-testid="success-toast"]').should("contain", "Profile updated");
    
    // Verify changes persisted
    cy.visit("/profile");
    cy.get('[data-testid="about-section"]').should("contain", "Passionate frontend engineer");
  });

  it("P0-009: Mobile responsive - core pages", () => {
    cy.viewport("iphone-x");
    
    cy.visit("/signup");
    cy.get('[data-testid="signup-form"]').should("be.visible");
    
    cy.visit("/jobs");
    cy.get('[data-testid="job-search-input"]').should("be.visible");
    cy.get('[data-testid="job-card"]').should("be.visible");
    
    cy.visit("/profile");
    cy.get('[data-testid="profile-card"]').should("be.visible");
  });

  it("P0-010: Auth flow - sign out and sign back in", () => {
    cy.login(TEST_USER.email, TEST_USER.password);
    cy.visit("/dashboard");
    
    cy.get('[data-testid="user-menu"]').click();
    cy.get('[data-testid="sign-out"]').click();
    
    cy.url().should("include", "/signin");
    
    cy.get('[data-testid="email-input"]').type(TEST_USER.email);
    cy.get('[data-testid="password-input"]').type(TEST_USER.password);
    cy.get('[data-testid="signin-submit"]').click();
    
    cy.url().should("include", "/dashboard");
    cy.get('[data-testid="welcome-message"]').should("contain", TEST_USER.firstName);
  });
});