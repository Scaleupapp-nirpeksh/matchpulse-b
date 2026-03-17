const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const env = require('../config/env');

let sesClient = null;

const getSESClient = () => {
  if (!sesClient && env.AWS_ACCESS_KEY_ID) {
    sesClient = new SESClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return sesClient;
};

class EmailService {
  /**
   * Send a transactional email via AWS SES
   */
  async sendEmail({ to, subject, html, text }) {
    const client = getSESClient();

    if (!client) {
      console.log(`📧 [DEV] Email to ${to}: ${subject}`);
      if (env.isDev()) return { success: true, message: 'Email logged (dev mode)' };
      throw new Error('Email service not configured');
    }

    try {
      const command = new SendEmailCommand({
        Source: env.AWS_SES_FROM_EMAIL,
        Destination: {
          ToAddresses: Array.isArray(to) ? to : [to],
        },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: html ? { Data: html, Charset: 'UTF-8' } : undefined,
            Text: text ? { Data: text, Charset: 'UTF-8' } : undefined,
          },
        },
      });

      const result = await client.send(command);
      return { success: true, messageId: result.MessageId };
    } catch (error) {
      console.error('❌ Email send error:', error.message);
      throw error;
    }
  }

  /**
   * Send invite email
   */
  async sendInviteEmail({ to, orgName, inviteCode, role, inviterName }) {
    const inviteUrl = `${env.CLIENT_URL}/invite/${inviteCode}`;

    const subject = `You're invited to join ${orgName} on MatchPulse`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1D9E75; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">🏆 MatchPulse</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>You've been invited!</h2>
          <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on MatchPulse as a <strong>${role}</strong>.</p>
          <p>MatchPulse is a live sports tournament platform where you can participate in and follow live-scored tournaments.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteUrl}" style="background: #1D9E75; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px;">Accept Invitation</a>
          </div>
          <p style="color: #666; font-size: 12px;">Or use this invite code: <strong>${inviteCode}</strong></p>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          <p>MatchPulse — Live Sports. Real Time. Your Community.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }

  /**
   * Send match assignment email to scorer
   */
  async sendScorerAssignmentEmail({ to, matchDetails, tournamentName }) {
    const subject = `You've been assigned to score a match — ${tournamentName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1D9E75; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">🏆 MatchPulse</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Match Scoring Assignment</h2>
          <p>You've been assigned to score the following match:</p>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Tournament:</strong> ${tournamentName}</p>
            <p><strong>Match:</strong> ${matchDetails.teamA} vs ${matchDetails.teamB}</p>
            <p><strong>Scheduled:</strong> ${matchDetails.scheduledAt || 'TBD'}</p>
            <p><strong>Venue:</strong> ${matchDetails.venue || 'TBD'}</p>
          </div>
          <p>Please ensure you're available and have the MatchPulse app or website ready before the match begins.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }

  /**
   * Send tournament digest email
   */
  async sendTournamentDigest({ to, tournamentName, summary }) {
    const subject = `Daily Update — ${tournamentName} | MatchPulse`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1D9E75; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">🏆 MatchPulse</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>${tournamentName} — Daily Update</h2>
          <div style="background: white; padding: 20px; border-radius: 8px;">
            ${summary}
          </div>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          <p>MatchPulse — Live Sports. Real Time. Your Community.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }
  /**
   * Send password reset email
   */
  async sendPasswordResetEmail({ to, resetToken, fullName }) {
    const resetUrl = `${env.CLIENT_URL}/reset-password/${resetToken}`;

    const subject = 'Reset your MatchPulse password';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1D9E75; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">🏆 MatchPulse</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Password Reset Request</h2>
          <p>Hi${fullName ? ` ${fullName}` : ''},</p>
          <p>We received a request to reset the password for your MatchPulse account. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #1D9E75; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 14px;">This link will expire in <strong>1 hour</strong>.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="color: #999; font-size: 12px; word-break: break-all;">${resetUrl}</p>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          <p>MatchPulse — Live Sports. Real Time. Your Community.</p>
        </div>
      </div>
    `;

    const text = `Hi${fullName ? ` ${fullName}` : ''},\n\nWe received a request to reset your MatchPulse password.\n\nVisit this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.\n\n— MatchPulse`;

    return this.sendEmail({ to, subject, html, text });
  }
}

module.exports = new EmailService();
