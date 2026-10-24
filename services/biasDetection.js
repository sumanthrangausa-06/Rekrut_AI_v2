const pool = require('../lib/db');

/**
 * Bias Detection Service
 * Analyzes demographic parity, score distributions, and identifies biased patterns
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Service pattern with static methods for backward compatibility
class BiasDetection {
	/**
	 * Calculate the four-fifths rule (80% rule) for a specific job posting.
	 * Selection rate of minority group / selection rate of majority group.
	 * Flag if ratio < 0.80.
	 */
	static async calculateFourFifthsRule(
		jobId,
		selectionStatuses = ['interview', 'hired', 'offer_extended'],
	) {
		try {
			const result = await pool.query(
				`
        WITH applicants AS (
          SELECT
            ja.candidate_id,
            ja.status,
            cd.gender,
            cd.ethnicity,
            cd.age_group,
            cd.disability_status
          FROM job_applications ja
          LEFT JOIN candidate_demographics cd ON cd.user_id = ja.candidate_id
          WHERE ja.job_id = $1
        ),
        group_stats AS (
          SELECT 'gender' as attr, gender as group_value,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = ANY($2)) as selected
          FROM applicants WHERE gender IS NOT NULL GROUP BY gender
          UNION ALL
          SELECT 'ethnicity' as attr, ethnicity as group_value,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = ANY($2)) as selected
          FROM applicants WHERE ethnicity IS NOT NULL GROUP BY ethnicity
          UNION ALL
          SELECT 'age_group' as attr, age_group as group_value,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = ANY($2)) as selected
          FROM applicants WHERE age_group IS NOT NULL GROUP BY age_group
          UNION ALL
          SELECT 'disability_status' as attr, disability_status as group_value,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = ANY($2)) as selected
          FROM applicants WHERE disability_status IS NOT NULL GROUP BY disability_status
        )
        SELECT attr, group_value, total, selected,
               CASE WHEN total > 0 THEN selected::decimal / total ELSE 0 END as selection_rate
        FROM group_stats
        ORDER BY attr, total DESC
      `,
				[jobId, selectionStatuses],
			);

			const byAttribute = {};
			result.rows.forEach((row) => {
				if (!byAttribute[row.attr]) byAttribute[row.attr] = [];
				byAttribute[row.attr].push(row);
			});

			const fourFifthsResults = [];
			Object.entries(byAttribute).forEach(([attr, groups]) => {
				if (groups.length < 2) return;
				const rates = groups.map((g) => parseFloat(g.selection_rate));
				const maxRate = Math.max(...rates);
				const minRate = Math.min(...rates);
				const ratio = maxRate > 0 ? minRate / maxRate : 0;
				fourFifthsResults.push({
					attribute: attr,
					groups,
					max_selection_rate: maxRate,
					min_selection_rate: minRate,
					ratio,
					flagged: ratio < 0.8,
					threshold: 0.8,
				});
			});

			return { job_id: jobId, four_fifths_results: fourFifthsResults };
		} catch (error) {
			console.error('Four-fifths rule calculation failed:', error);
			throw error;
		}
	}

	/**
	 * Analyze demographic parity across OmniScore results
	 * Checks if scores are distributed fairly across demographic groups
	 */
	static async analyzeDemographicParity() {
		try {
			// Get OmniScore distribution by demographic groups.
			// #1522 (Rex #1152 §3.2/§4 R6): repointed from the never-written
			// omniscore_results to live omni_scores. total_score is native
			// 300-850 (NULL = no data); every aggregate below runs over the
			// normalised value (total_score - 300) / 5.5 AS overall_score_norm,
			// converted once at this SQL boundary, so the >10 gap threshold
			// and disparity math keep their 0-100 meaning.
			const scoresByDemographics = await pool.query(`
        SELECT
          cd.gender,
          cd.ethnicity,
          cd.age_group AS age_range,
          COUNT(*) as total_candidates,
          AVG((os.total_score - 300) / 5.5) as avg_score,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (os.total_score - 300) / 5.5) as median_score,
          MIN((os.total_score - 300) / 5.5) as min_score,
          MAX((os.total_score - 300) / 5.5) as max_score,
          STDDEV((os.total_score - 300) / 5.5) as score_stddev
        FROM candidate_profiles cp
        LEFT JOIN candidate_demographics cd ON cd.user_id = cp.user_id
        LEFT JOIN omni_scores os ON os.user_id = cp.user_id
        WHERE os.total_score IS NOT NULL
        GROUP BY cd.gender, cd.ethnicity, cd.age_group
      `);

			// Calculate disparity metrics
			const findings = {
				by_gender: BiasDetection._calculateDisparity(
					scoresByDemographics.rows.filter((r) => r.gender),
					'gender',
				),
				by_ethnicity: BiasDetection._calculateDisparity(
					scoresByDemographics.rows.filter((r) => r.ethnicity),
					'ethnicity',
				),
				by_age: BiasDetection._calculateDisparity(
					scoresByDemographics.rows.filter((r) => r.age_range),
					'age_range',
				),
			};

			// Flag potentially biased patterns
			const flaggedPatterns = [];

			// Check for significant score gaps (>10 points)
			Object.entries(findings).forEach(([category, data]) => {
				if (data.max_avg_score - data.min_avg_score > 10) {
					flaggedPatterns.push({
						category,
						issue: 'significant_score_gap',
						gap: data.max_avg_score - data.min_avg_score,
						details: `${data.max_group} scores ${(data.max_avg_score - data.min_avg_score).toFixed(1)} points higher than ${data.min_group}`,
					});
				}
			});

			return {
				findings,
				flaggedPatterns,
				rawData: scoresByDemographics.rows,
			};
		} catch (error) {
			console.error('Demographic parity analysis failed:', error);
			throw error;
		}
	}

	/**
	 * Calculate disparity metrics for a demographic category
	 */
	static _calculateDisparity(rows, groupField) {
		if (rows.length === 0) {
			return { message: 'Insufficient data' };
		}

		const groups = {};
		rows.forEach((row) => {
			const group = row[groupField];
			if (!groups[group]) {
				groups[group] = {
					count: parseInt(row.total_candidates, 10),
					avgScore: parseFloat(row.avg_score),
					medianScore: parseFloat(row.median_score),
				};
			}
		});

		const avgScores = Object.values(groups).map((g) => g.avgScore);
		const maxAvg = Math.max(...avgScores);
		const minAvg = Math.min(...avgScores);
		const maxGroup = Object.keys(groups).find((k) => groups[k].avgScore === maxAvg);
		const minGroup = Object.keys(groups).find((k) => groups[k].avgScore === minAvg);

		return {
			groups,
			max_avg_score: maxAvg,
			min_avg_score: minAvg,
			max_group: maxGroup,
			min_group: minGroup,
			disparity_ratio: maxAvg / minAvg,
			overall_avg: avgScores.reduce((a, b) => a + b, 0) / avgScores.length,
		};
	}

	/**
	 * Analyze score distribution across all candidates
	 * Identifies potential algorithmic bias
	 */
	static async analyzeScoreDistribution() {
		// #1522 (Rex #1152 §3.2/§4 R6): repointed to omni_scores; buckets are
		// computed over overall_score_norm so FLOOR(norm/10)*10 and the
		// bucket labels keep their 0-100 meaning. Factor averages are native
		// 0-100 pass-through: technical <- technical_score, behavioral <-
		// behavior_score, experience <- factor_scores.experience_quality
		// (no experience_score column exists; AVG ignores NULL factors).
		const distribution = await pool.query(`
      SELECT
        FLOOR(((total_score - 300) / 5.5) / 10) * 10 as score_bucket,
        COUNT(*) as candidate_count,
        AVG(technical_score) as avg_technical,
        AVG(behavior_score) as avg_behavioral,
        AVG((factor_scores->>'experience_quality')::numeric) as avg_experience
      FROM omni_scores
      WHERE total_score IS NOT NULL
      GROUP BY score_bucket
      ORDER BY score_bucket
    `);

		// Check for unexpected clustering
		const buckets = distribution.rows;
		const avgBucketSize =
			buckets.reduce((sum, b) => sum + parseInt(b.candidate_count, 10), 0) / buckets.length;

		const anomalies = buckets
			.filter((b) => parseInt(b.candidate_count, 10) > avgBucketSize * 2)
			.map((b) => ({
				score_range: `${b.score_bucket}-${parseInt(b.score_bucket, 10) + 9}`,
				count: parseInt(b.candidate_count, 10),
				expected: avgBucketSize.toFixed(0),
				ratio: (parseInt(b.candidate_count, 10) / avgBucketSize).toFixed(2),
			}));

		return {
			distribution: distribution.rows,
			anomalies,
			total_candidates: buckets.reduce((sum, b) => sum + parseInt(b.candidate_count, 10), 0),
		};
	}

	/**
	 * Generate a comprehensive bias report
	 */
	static async generateReport() {
		const [demographicAnalysis, distributionAnalysis] = await Promise.all([
			BiasDetection.analyzeDemographicParity(),
			BiasDetection.analyzeScoreDistribution(),
		]);

		// #1517: zero scored candidates means there is nothing to audit.
		// Never persist a bias_reports row that reads as a clean audit on
		// no data — return an explicit insufficient-data result instead.
		if (distributionAnalysis.total_candidates === 0) {
			return {
				reportId: null,
				insufficient_data: true,
				demographicAnalysis,
				distributionAnalysis,
				recommendations: [],
			};
		}

		const recommendations = [];

		// Generate recommendations based on findings
		if (demographicAnalysis.flaggedPatterns.length > 0) {
			recommendations.push({
				priority: 'high',
				action: 'Review scoring algorithm for demographic bias',
				details: `Found ${demographicAnalysis.flaggedPatterns.length} significant score disparities across demographics`,
			});
		}

		if (distributionAnalysis.anomalies.length > 0) {
			recommendations.push({
				priority: 'medium',
				action: 'Investigate score clustering',
				details: `${distributionAnalysis.anomalies.length} score ranges have unusually high candidate counts`,
			});
		}

		// Save report to database
		const reportDate = new Date().toISOString().split('T')[0];
		const result = await pool.query(
			`INSERT INTO bias_reports (report_date, analysis_type, findings, flagged_patterns, recommendations)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
			[
				reportDate,
				'demographic_parity',
				JSON.stringify({
					demographic: demographicAnalysis,
					distribution: distributionAnalysis,
				}),
				JSON.stringify(demographicAnalysis.flaggedPatterns),
				JSON.stringify(recommendations),
			],
		);

		return {
			reportId: result.rows[0].id,
			demographicAnalysis,
			distributionAnalysis,
			recommendations,
		};
	}

	/**
	 * Get historical bias reports
	 */
	static async getReports({ limit = 10, offset = 0 }) {
		const result = await pool.query(
			`SELECT * FROM bias_reports
       ORDER BY report_date DESC
       LIMIT $1 OFFSET $2`,
			[limit, offset],
		);
		return result.rows;
	}
}

module.exports = BiasDetection;
