/**
 * FieldOps Mobile — Hold State Mechanism.
 * Implements "Put on Hold" with mandatory reason and notes.
 * Pauses active wrench time and records hold duration intervals.
 */
import { createRecord, updateRecord, listRecords } from '../api.js';
import { HOLD_REASONS } from '../config.js';

export class HoldStateService {
  /**
   * Apply a hold on a job card.
   * Creates a job_card_holds record and updates job_cards status to ON_HOLD.
   */
  static async applyHold(jobCode, reason, notes = '') {
    if (!Object.values(HOLD_REASONS).includes(reason)) {
      throw new Error(`Invalid hold reason: ${reason}`);
    }

    // Find job by job_code
    const jobRes = await listRecords('job_cards', { filter: `job_code = "${jobCode}"`, perPage: 1 });
    const job = jobRes.items?.[0];
    if (!job) throw new Error(`Job ${jobCode} not found.`);

    // Create hold record
    await createRecord('job_card_holds', {
      job_card_id: job.id,
      reason,
      notes: `${notes} | ${new Date().toISOString()}`,
      held_at: new Date().toISOString(),
    });

    // Update job card status
    await updateRecord('job_cards', job.id, {
      status: 'ON_HOLD',
      delay_category: reason,
      delay_reason: notes,
    });
  }

  /**
   * Resume a held job.
   * Closes the latest open hold and sets job_cards back to IN_PROGRESS.
   */
  static async resumeJob(jobCode, notes = '') {
    const jobRes = await listRecords('job_cards', { filter: `job_code = "${jobCode}"`, perPage: 1 });
    const job = jobRes.items?.[0];
    if (!job) throw new Error(`Job ${jobCode} not found.`);

    // Find open holds
    const holdsRes = await listRecords('job_card_holds', {
      filter: `job_card_id = "${job.id}" && resumed_at = ""`,
      sort: '-created',
      perPage: 1,
    });
    const hold = holdsRes.items?.[0];
    if (hold) {
      await updateRecord('job_card_holds', hold.id, {
        resumed_at: new Date().toISOString(),
        notes: `${hold.notes || ''} | Resumed: ${notes || ''}`,
      });
    }

    await updateRecord('job_cards', job.id, {
      status: 'IN_PROGRESS',
      delay_category: '',
      delay_reason: notes,
    });
  }

  /**
   * Get hold history for a job card.
   */
  static async getHoldHistory(jobCode) {
    const jobRes = await listRecords('job_cards', { filter: `job_code = "${jobCode}"`, perPage: 1 });
    const job = jobRes.items?.[0];
    if (!job) return [];

    const holdsRes = await listRecords('job_card_holds', {
      filter: `job_card_id = "${job.id}"`,
      sort: '-created',
    });
    return holdsRes.items || [];
  }
}

export default new HoldStateService();