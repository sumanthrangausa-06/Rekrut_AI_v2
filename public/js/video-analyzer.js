/**
 * AI Video Analysis Library
 * Uses TensorFlow.js for real-time face tracking, eye contact, and expression analysis
 */

class VideoAnalyzer {
  constructor() {
    this.model = null;
    this.isAnalyzing = false;
    this.frameData = [];
    this.listeners = {};
    this.startTime = null;
  }

  /**
   * Initialize TensorFlow.js face landmarks model
   */
  async init() {
    try {
      // Load BlazeFace model for face detection (lightweight, fast)
      this.model = await blazeface.load();
      console.log('Video analyzer initialized');
      return true;
    } catch (err) {
      console.error('Failed to load video analysis model:', err);
      return false;
    }
  }

  /**
   * Start analyzing video stream
   * @param {HTMLVideoElement} videoElement
   * @param {number} sampleRate - Analyze every N milliseconds (default: 500ms)
   */
  startAnalysis(videoElement, sampleRate = 500) {
    if (!this.model) {
      console.error('Model not initialized. Call init() first.');
      return;
    }

    this.isAnalyzing = true;
    this.startTime = Date.now();
    this.frameData = [];

    const analyze = async () => {
      if (!this.isAnalyzing) return;

      try {
        const timestamp = Date.now() - this.startTime;
        const frame = await this.analyzeFrame(videoElement, timestamp);

        if (frame) {
          this.frameData.push(frame);
          this.emit('frame', frame);

          // Calculate live scores every 5 seconds
          if (this.frameData.length % 10 === 0) {
            const scores = this.calculateLiveScores();
            this.emit('scores', scores);
          }
        }
      } catch (err) {
        console.error('Frame analysis error:', err);
      }

      setTimeout(analyze, sampleRate);
    };

    analyze();
  }

  /**
   * Stop analyzing
   */
  stopAnalysis() {
    this.isAnalyzing = false;
  }

  /**
   * Analyze a single frame
   */
  async analyzeFrame(videoElement, timestamp) {
    try {
      const predictions = await this.model.estimateFaces(videoElement, false);

      if (predictions.length === 0) {
        return {
          timestamp,
          faceDetected: false,
          eyeContact: 0,
          headPose: 'unknown',
          confidence: 0
        };
      }

      const face = predictions[0];

      // Calculate eye contact (center focus)
      const eyeContact = this.calculateEyeContact(face, videoElement);

      // Estimate head pose
      const headPose = this.estimateHeadPose(face, videoElement);

      // Detect micro-expressions (simplified)
      const expression = this.detectExpression(face);

      return {
        timestamp,
        faceDetected: true,
        eyeContact,
        headPose,
        expression,
        confidence: face.probability[0],
        boundingBox: face.topLeft
      };
    } catch (err) {
      console.error('Frame analysis error:', err);
      return null;
    }
  }

  /**
   * Calculate eye contact score (0-100)
   * Higher when face is centered and looking forward
   */
  calculateEyeContact(face, videoElement) {
    const [x, y] = face.topLeft;
    const [width, height] = [face.bottomRight[0] - face.topLeft[0], face.bottomRight[1] - face.topLeft[1]];

    const centerX = x + width / 2;
    const centerY = y + height / 2;

    const videoCenterX = videoElement.videoWidth / 2;
    const videoCenterY = videoElement.videoHeight / 2;

    // Distance from center (normalized)
    const distX = Math.abs(centerX - videoCenterX) / (videoElement.videoWidth / 2);
    const distY = Math.abs(centerY - videoCenterY) / (videoElement.videoHeight / 2);

    const distance = Math.sqrt(distX * distX + distY * distY);

    // Score: 100 when centered, decreases with distance
    const score = Math.max(0, Math.min(100, 100 - (distance * 50)));

    return Math.round(score);
  }

  /**
   * Estimate head pose (simplified)
   */
  estimateHeadPose(face, videoElement) {
    const [x, y] = face.topLeft;
    const [width, height] = [face.bottomRight[0] - face.topLeft[0], face.bottomRight[1] - face.topLeft[1]];

    const centerX = x + width / 2;
    const videoCenterX = videoElement.videoWidth / 2;

    const xOffset = (centerX - videoCenterX) / (videoElement.videoWidth / 2);

    if (xOffset < -0.3) return 'left';
    if (xOffset > 0.3) return 'right';
    if (height / width < 1.2) return 'down';
    if (height / width > 1.5) return 'up';
    return 'forward';
  }

  /**
   * Detect expression (simplified - would need dedicated model for accuracy)
   */
  detectExpression(face) {
    // This is a placeholder - real expression detection needs FaceMesh or similar
    // For now, use confidence and face size as proxy
    const confidence = face.probability[0];

    if (confidence > 0.95) return 'confident';
    if (confidence > 0.85) return 'neutral';
    if (confidence < 0.7) return 'nervous';
    return 'neutral';
  }

  /**
   * Calculate live scores from collected frames
   */
  calculateLiveScores() {
    if (this.frameData.length === 0) {
      return {
        eyeContact: 0,
        headStability: 0,
        presence: 0
      };
    }

    const recentFrames = this.frameData.slice(-20); // Last 20 frames (~10 seconds)

    // Eye contact: average of scores where face was detected
    const eyeContactFrames = recentFrames.filter(f => f.faceDetected);
    const eyeContact = eyeContactFrames.length > 0
      ? eyeContactFrames.reduce((sum, f) => sum + f.eyeContact, 0) / eyeContactFrames.length
      : 0;

    // Head stability: consistency of head pose
    const forwardFrames = recentFrames.filter(f => f.headPose === 'forward').length;
    const headStability = (forwardFrames / recentFrames.length) * 100;

    // Presence: how often face is detected
    const presence = (eyeContactFrames.length / recentFrames.length) * 100;

    return {
      eyeContact: Math.round(eyeContact),
      headStability: Math.round(headStability),
      presence: Math.round(presence)
    };
  }

  /**
   * Get final analysis summary
   */
  getFinalAnalysis() {
    if (this.frameData.length === 0) {
      return null;
    }

    const totalDuration = (Date.now() - this.startTime) / 1000; // seconds

    // Calculate overall metrics
    const framesWithFace = this.frameData.filter(f => f.faceDetected);
    const presencePercent = (framesWithFace.length / this.frameData.length) * 100;

    const avgEyeContact = framesWithFace.length > 0
      ? framesWithFace.reduce((sum, f) => sum + f.eyeContact, 0) / framesWithFace.length
      : 0;

    // Head pose distribution
    const poseCount = {
      forward: 0,
      left: 0,
      right: 0,
      up: 0,
      down: 0,
      unknown: 0
    };

    framesWithFace.forEach(f => {
      poseCount[f.headPose]++;
    });

    // Expression distribution
    const expressionCount = {
      confident: 0,
      neutral: 0,
      nervous: 0
    };

    framesWithFace.forEach(f => {
      expressionCount[f.expression]++;
    });

    // Calculate scores (0-100)
    const eyeContactScore = avgEyeContact;
    const bodyLanguageScore = (poseCount.forward / framesWithFace.length) * 100;
    const expressionScore = ((expressionCount.confident * 1.0 + expressionCount.neutral * 0.7 + expressionCount.nervous * 0.3) / framesWithFace.length) * 100;
    const presenceScore = presencePercent;

    // Overall presentation score
    const presentationScore = (
      eyeContactScore * 0.35 +
      bodyLanguageScore * 0.25 +
      expressionScore * 0.25 +
      presenceScore * 0.15
    );

    return {
      duration: totalDuration,
      totalFrames: this.frameData.length,
      framesAnalyzed: framesWithFace.length,
      scores: {
        eyeContact: Math.round(eyeContactScore),
        bodyLanguage: Math.round(bodyLanguageScore),
        expression: Math.round(expressionScore),
        presence: Math.round(presenceScore),
        presentation: Math.round(presentationScore)
      },
      insights: {
        poseDistribution: poseCount,
        expressionDistribution: expressionCount,
        avgConfidence: framesWithFace.reduce((sum, f) => sum + (f.confidence || 0), 0) / framesWithFace.length
      },
      frameData: this.frameData // Include for detailed timeline
    };
  }

  /**
   * Event listener system
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  /**
   * Reset analyzer
   */
  reset() {
    this.stopAnalysis();
    this.frameData = [];
    this.startTime = null;
  }
}

// Export for use
window.VideoAnalyzer = VideoAnalyzer;
