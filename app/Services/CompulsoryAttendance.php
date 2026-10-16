<?php

namespace App\Services;

use App\Models\Event;
use App\Models\EventObligation;
use App\Models\StudentFine;
use App\Models\UserAccount;
use App\Support\AcademicStructure;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CompulsoryAttendance
{
    /** Freeze the eligible active-student audience at policy publication time. */
    public function finalizeRoster(Event $event): int
    {
        $event->refresh();
        if (! $event->attendance_compulsory) {
            throw ValidationException::withMessages(['attendance_compulsory' => 'Enable compulsory attendance before finalizing its roster.']);
        }
        if (! in_array($event->status, ['Approved', 'Completed'], true)) {
            throw ValidationException::withMessages(['status' => 'Approve the event before finalizing its required-student roster.']);
        }
        if ($event->target_role === 'Admin') {
            throw ValidationException::withMessages(['target_role' => 'Compulsory attendance rosters can only include students.']);
        }

        return DB::transaction(function () use ($event): int {
            $lockedEvent = Event::whereKey($event->id)->lockForUpdate()->firstOrFail();
            if ($lockedEvent->attendance_roster_finalized_at) {
                return $lockedEvent->attendanceObligations()->count();
            }

            if ($lockedEvent->attendanceObligations()->exists()) {
                $lockedEvent->forceFill(['attendance_roster_finalized_at' => now()])->save();
                return $lockedEvent->attendanceObligations()->count();
            }

            $students = UserAccount::query()->where('role', 'Student')->where('status', 'Active');
            if ($lockedEvent->target_course) $students->where('course', $lockedEvent->target_course);
            if ($lockedEvent->target_year) $students->where('year', $lockedEvent->target_year);
            if ($lockedEvent->target_block) $students->where('block_no', $lockedEvent->target_block);
            if ($lockedEvent->target_department) {
                $students->whereIn('course', AcademicStructure::coursesForDepartment($lockedEvent->target_department));
            }

            $now = now();
            $created = 0;
            $students->orderBy('id')->chunkById(500, function ($batch) use ($event, $now, &$created): void {
                foreach ($batch as $student) {
                    EventObligation::firstOrCreate(
                        ['event_id' => $event->id, 'user_account_id' => $student->id],
                        [
                            'student_reference' => $student->reference,
                            'student_id' => $student->student_id,
                            'student_name' => $student->name,
                            'student_email' => $student->email,
                            'department' => $student->department,
                            'course' => $student->course,
                            'year' => $student->year,
                            'block_no' => $student->block_no,
                            'status' => 'required',
                            'finalized_at' => $now,
                        ]
                    );
                    $created++;
                }
            });
            $lockedEvent->forceFill(['attendance_roster_finalized_at' => $now])->save();

            return $created;
        });
    }

    /** Create reviewable fine proposals after the event's correction period. */
    public function assess(Event $event, ?int $actorId = null): array
    {
        $event->refresh();
        if (! $event->attendance_compulsory || $event->status === 'Cancelled') {
            throw ValidationException::withMessages(['event' => 'Only active compulsory events can be assessed.']);
        }
        if ($event->status !== 'Completed') {
            throw ValidationException::withMessages(['status' => 'Mark the event Completed before assessing attendance.']);
        }
        if (! $event->attendance_roster_finalized_at) {
            throw ValidationException::withMessages(['roster' => 'Finalize the required-student roster before assessment.']);
        }
        if ($event->attendance_correction_deadline && now()->lt($event->attendance_correction_deadline)) {
            throw ValidationException::withMessages(['attendance_correction_deadline' => 'The correction period is still open.']);
        }
        $eventEnd = $event->end_date ?? $event->event_date;
        if ($eventEnd && now()->toDateString() <= $eventEnd->format('Y-m-d')) {
            throw ValidationException::withMessages(['event_date' => 'Fine assessment is available after the event has ended.']);
        }

        $sessions = $event->attendanceSessions()->get();
        if ($sessions->isEmpty() || $sessions->contains(fn ($session) => $session->isOpen())) {
            throw ValidationException::withMessages(['sessions' => 'Close all attendance sessions before assessment.']);
        }

        return DB::transaction(function () use ($event, $sessions, $actorId): array {
            $proposed = 0;
            $held = 0;
            foreach ($event->attendanceObligations()->with(['attendances', 'excuseRequests'])->get() as $obligation) {
                if ($obligation->excuseRequests->contains(fn ($request) => in_array($request->status, ['pending', 'approved'], true))) {
                    $held++;
                    continue;
                }

                $punches = $obligation->attendances;
                $hasIn = $punches->contains(fn ($attendance) => $attendance->time_in !== null);
                $hasOutWithoutIn = $punches->contains(fn ($attendance) => $attendance->time_out !== null && $attendance->time_in === null);
                if ($hasOutWithoutIn) {
                    $obligation->update(['status' => 'review_required']);
                    $held++;
                    continue;
                }

                $completeEverySession = $sessions->every(function ($session) use ($punches, $event): bool {
                    $punch = $punches->firstWhere('attendance_session_id', $session->id);
                    return $punch && $punch->time_in !== null
                        && (! $event->attendance_requires_checkout || $punch->time_out !== null);
                });
                if ($completeEverySession) continue;

                $amount = $hasIn ? $event->incomplete_fine_amount : $event->absence_fine_amount;
                if ($amount === null || (float) $amount <= 0) continue;

                $fine = StudentFine::firstOrCreate(
                    ['event_obligation_id' => $obligation->id],
                    ['amount' => $amount, 'reason' => $hasIn ? 'incomplete_attendance' : 'absence', 'assessment_status' => 'proposed', 'payment_status' => 'unpaid']
                );
                if ($fine->wasRecentlyCreated) {
                    DB::table('fine_audit_logs')->insert([
                        'student_fine_id' => $fine->id, 'event_obligation_id' => $obligation->id,
                        'actor_user_id' => $actorId, 'action' => 'fine_proposed',
                        'details' => json_encode(['amount' => $amount, 'reason' => $fine->reason]),
                        'created_at' => now(), 'updated_at' => now(),
                    ]);
                    $proposed++;
                }
            }

            return ['proposed' => $proposed, 'held_for_review' => $held];
        });
    }
}
