<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ExcuseRequest;
use App\Models\Event;
use App\Models\EventObligation;
use App\Models\FinePayment;
use App\Models\Setting;
use App\Models\StudentFine;
use App\Models\UserAccount;
use App\Services\CompulsoryAttendance;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class StudentAttendanceController extends Controller
{
    public function myQr(Request $request)
    {
        abort_unless($request->user()->role === 'Student', 403);
        return response()->json(['qr_token' => $request->user()->attendance_qr_token]);
    }

    public function obligations(Request $request)
    {
        abort_unless($request->user()->role === 'Student', 403);
        return response()->json(EventObligation::with(['event.attendanceSessions', 'attendances.session', 'fine.payments', 'excuseRequests'])
            ->where('user_account_id', $request->user()->id)
            ->orderByDesc('finalized_at')->get()->map(fn ($item) => $this->obligationPayload($item)));
    }

    /** Return the authenticated student's General Assembly attendance and fine details. */
    public function generalAssemblyDetails(Request $request)
    {
        abort_unless($request->user()->role === 'Student', 403);

        $obligation = EventObligation::with(['event.attendanceSessions', 'attendances.session', 'fine.payments', 'excuseRequests'])
            ->where('user_account_id', $request->user()->id)
            ->whereHas('event', fn ($query) => $query->whereRaw('LOWER(title) LIKE ?', ['%general assembly%']))
            ->orderByDesc('finalized_at')
            ->first();

        if (! $obligation || ! $obligation->event) {
            return response()->json(['message' => 'No General Assembly attendance record is available.'], 404);
        }

        $event = $obligation->event;
        $payload = $this->obligationPayload($obligation);
        $session = collect($payload['attendance'])->first() ?? [];
        $fine = $payload['fine'] ?? [];

        return response()->json([
            'event' => [
                'id' => $event->id,
                'reference' => $event->reference,
                'title' => $event->title,
                'date' => $event->event_date?->format('F j, Y'),
                'time' => trim(($event->start_time ?? '').' - '.($event->end_time ?? '')),
                'venue' => $event->venue,
                'required_participants' => $event->target_department
                    ? ($event->target_department.' students')
                    : 'All TMC students',
            ],
            'attendance' => [
                'status' => $payload['attendance_status'],
                'time_in' => $session['time_in'] ?? null,
                'time_out' => $session['time_out'] ?? null,
                'scans_recorded' => $payload['scans_recorded'],
                'required_scans' => $payload['required_scans'],
                'appeal_status' => $payload['appeal_status'],
            ],
            'fine' => [
                'amount' => $fine['amount'] ?? null,
                'paid_amount' => $fine['amount_paid'] ?? null,
                'adjustment_amount' => 0,
                'balance' => $fine['outstanding_balance'] ?? null,
                'assessment_status' => $fine['assessment_status'] ?? 'not_assessed',
                'payment_status' => $fine['payment_status'] ?? 'not_assessed',
                'reason' => $fine['reason'] ?? null,
            ],
        ]);
    }

    public function fines(Request $request)
    {
        abort_unless($request->user()->role === 'Student', 403);
        return response()->json(StudentFine::with(['obligation.event', 'payments'])
            ->whereHas('obligation', fn ($q) => $q->where('user_account_id', $request->user()->id))
            ->latest()->get()->map(fn (StudentFine $fine) => $this->finePayload($fine)));
    }

    /** Return payment channels configured by an administrator. */
    public function paymentOptions(Request $request)
    {
        abort_unless($request->user()->role === 'Student', 403);

        return response()->json([
            'options' => collect(Setting::value('fine_payment_options', []))
                ->filter(fn ($option) => is_array($option) && ($option['active'] ?? true))
                ->values(),
        ]);
    }

    /** Submit an attendance excuse/correction appeal for the authenticated student. */
    public function submitAppeal(Request $request, Event $event)
    {
        abort_unless($request->user()->role === 'Student', 403);

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:4000'],
        ]);

        $obligation = EventObligation::where('event_id', $event->id)
            ->where('user_account_id', $request->user()->id)
            ->firstOrFail();

        if (! $event->attendance_compulsory) {
            throw ValidationException::withMessages(['event' => 'This event does not have compulsory attendance records.']);
        }
        if ($event->status !== 'Completed') {
            throw ValidationException::withMessages(['event' => 'Appeals may be submitted after the event has been completed.']);
        }

        $deadline = $event->attendance_correction_deadline ?? $event->excuse_deadline;
        if ($deadline && now()->greaterThan($deadline)) {
            throw ValidationException::withMessages(['appeal' => 'The attendance correction period has ended.']);
        }

        if ($obligation->excuseRequests()->where('status', 'approved')->exists()) {
            throw ValidationException::withMessages(['appeal' => 'This attendance record already has an approved appeal.']);
        }

        if ($obligation->excuseRequests()->where('status', 'pending')->exists()) {
            throw ValidationException::withMessages(['appeal' => 'An appeal for this event is already under review.']);
        }

        $appeal = $obligation->excuseRequests()->create([
            'user_account_id' => $request->user()->id,
            'reason' => trim($data['reason']),
            'status' => 'pending',
        ]);

        DB::table('fine_audit_logs')->insert([
            'event_obligation_id' => $obligation->id,
            'actor_user_id' => $request->user()->id,
            'action' => 'attendance_appeal_submitted',
            'details' => json_encode(['appeal_id' => $appeal->id]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json([
            'message' => 'Your appeal was submitted for review.',
            'appeal' => $appeal,
        ], 201);
    }

    /** Review a submitted appeal. Only the admin API group may call this. */
    public function reviewAppeal(Request $request, ExcuseRequest $appeal)
    {
        $data = $request->validate([
            'decision' => ['required', Rule::in(['approve', 'reject'])],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        if ($appeal->status !== 'pending') {
            throw ValidationException::withMessages(['appeal' => 'Only pending appeals can be reviewed.']);
        }

        DB::transaction(function () use ($appeal, $data, $request): void {
            $lockedAppeal = ExcuseRequest::whereKey($appeal->id)->lockForUpdate()->firstOrFail();
            if ($lockedAppeal->status !== 'pending') {
                throw ValidationException::withMessages(['appeal' => 'This appeal has already been reviewed.']);
            }

            $lockedAppeal->update([
                'status' => $data['decision'] === 'approve' ? 'approved' : 'rejected',
                'reviewed_by_user_id' => $request->user()->id,
                'reviewed_at' => now(),
                'review_note' => $data['note'] ?? null,
            ]);

            if ($data['decision'] === 'approve') {
                $lockedAppeal->obligation()->update(['status' => 'excused']);
                $fine = $lockedAppeal->obligation->fine;
                if ($fine && in_array($fine->assessment_status, ['proposed', 'approved'], true)) {
                    $fine->update(['assessment_status' => 'waived']);
                }
            }

            DB::table('fine_audit_logs')->insert([
                'student_fine_id' => $lockedAppeal->obligation->fine?->id,
                'event_obligation_id' => $lockedAppeal->event_obligation_id,
                'actor_user_id' => $request->user()->id,
                'action' => 'attendance_appeal_'.$data['decision'],
                'details' => json_encode(['appeal_id' => $lockedAppeal->id, 'note' => $data['note'] ?? null]),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return response()->json(['message' => 'Appeal review saved.', 'appeal' => $appeal->fresh()]);
    }

    /** Record a verified payment against an approved fine. */
    public function recordPayment(Request $request, StudentFine $fine)
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'receipt_reference' => ['required', 'string', 'max:50', Rule::unique('fine_payments', 'receipt_reference')],
            'method' => ['required', 'string', 'max:40'],
            'paid_at' => ['nullable', 'date'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $payment = DB::transaction(function () use ($fine, $data, $request): FinePayment {
            $lockedFine = StudentFine::whereKey($fine->id)->lockForUpdate()->firstOrFail();
            if ($lockedFine->assessment_status !== 'approved') {
                throw ValidationException::withMessages(['fine' => 'Payments can only be recorded for approved fines.']);
            }

            $amountCents = (int) round((float) $data['amount'] * 100);
            $totalCents = (int) round((float) $lockedFine->amount * 100);
            $paidCents = (int) round((float) $lockedFine->amount_paid * 100);
            if ($amountCents > $totalCents - $paidCents) {
                throw ValidationException::withMessages(['amount' => 'The payment exceeds the outstanding balance.']);
            }

            $payment = $lockedFine->payments()->create([
                'amount' => number_format($amountCents / 100, 2, '.', ''),
                'receipt_reference' => trim($data['receipt_reference']),
                'method' => trim($data['method']),
                'paid_at' => $data['paid_at'] ?? now(),
                'recorded_by_user_id' => $request->user()->id,
                'note' => $data['note'] ?? null,
            ]);

            $newPaidCents = $paidCents + $amountCents;
            $lockedFine->update([
                'amount_paid' => number_format($newPaidCents / 100, 2, '.', ''),
                'payment_status' => $newPaidCents >= $totalCents ? 'paid' : 'partial',
            ]);

            DB::table('fine_audit_logs')->insert([
                'student_fine_id' => $lockedFine->id,
                'event_obligation_id' => $lockedFine->event_obligation_id,
                'actor_user_id' => $request->user()->id,
                'action' => 'fine_payment_recorded',
                'details' => json_encode([
                    'amount' => $payment->amount,
                    'receipt_reference' => $payment->receipt_reference,
                    'method' => $payment->method,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return $payment;
        });

        return response()->json(['message' => 'Verified payment recorded.', 'payment' => $payment]);
    }

    public function adminObligations(Event $event)
    {
        return response()->json([
            'event' => [
                'reference' => $event->reference, 'title' => $event->title,
                'attendance_compulsory' => $event->attendance_compulsory,
                'roster_finalized_at' => $event->attendance_roster_finalized_at,
            ],
            'obligations' => $event->attendanceObligations()->with(['attendances.session', 'fine', 'excuseRequests'])->orderBy('student_name')->get(),
        ]);
    }

    public function finalizeRoster(Event $event, CompulsoryAttendance $service)
    {
        $count = $service->finalizeRoster($event);
        return response()->json(['message' => 'Required-student roster finalized.', 'count' => $count]);
    }

    public function assess(Event $event, CompulsoryAttendance $service)
    {
        return response()->json(['message' => 'Assessment complete. Proposed fines require administrator review.', ...$service->assess($event, request()->user()?->id)]);
    }

    public function reviewFine(Request $request, StudentFine $fine)
    {
        $data = $request->validate([
            'decision' => ['required', Rule::in(['approve', 'reject', 'waive'])],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);
        if ($fine->assessment_status !== 'proposed') {
            throw ValidationException::withMessages(['fine' => 'Only proposed fines can be reviewed.']);
        }
        DB::transaction(function () use ($fine, $data, $request): void {
            $fine->update([
                'assessment_status' => $data['decision'] === 'approve' ? 'approved' : ($data['decision'] === 'waive' ? 'waived' : 'rejected'),
                'reviewed_by_user_id' => $request->user()->id,
                'reviewed_at' => now(),
                'review_note' => $data['note'] ?? null,
            ]);
            DB::table('fine_audit_logs')->insert([
                'student_fine_id' => $fine->id, 'event_obligation_id' => $fine->event_obligation_id,
                'actor_user_id' => $request->user()->id, 'action' => 'fine_'.$data['decision'],
                'details' => json_encode(['amount' => $fine->amount, 'note' => $data['note'] ?? null]),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });
        return response()->json(['message' => 'Fine review saved.', 'fine' => $fine->fresh()]);
    }

    private function obligationPayload(EventObligation $item): array
    {
        $event = $item->event;
        $sessions = $event?->attendanceSessions ?? collect();
        $attendanceBySession = $item->attendances->keyBy('attendance_session_id');
        $sessionRows = $sessions->map(function ($session) use ($attendanceBySession): array {
            $punch = $attendanceBySession->get($session->id);
            return [
                'id' => $session->id,
                'label' => $session->label,
                'date' => $session->session_date?->format('Y-m-d'),
                'start_time' => $session->time_in,
                'end_time' => $session->time_out,
                'time_in' => $punch?->time_in,
                'time_out' => $punch?->time_out,
                'status' => $punch?->status ?? 'Missing',
            ];
        });
        $requiresCheckout = (bool) ($event?->attendance_requires_checkout ?? true);
        $requiredScans = $sessions->count() * ($requiresCheckout ? 2 : 1);
        $scansRecorded = $sessionRows->sum(fn (array $session) => (int) ($session['time_in'] !== null) + (int) ($requiresCheckout && $session['time_out'] !== null));
        $appeals = $item->excuseRequests->map(fn (ExcuseRequest $appeal) => [
            'id' => $appeal->id,
            'reason' => $appeal->reason,
            'status' => $appeal->status,
            'submitted_at' => $appeal->created_at,
            'reviewed_at' => $appeal->reviewed_at,
            'review_note' => $appeal->review_note,
        ])->values();
        $appealStatus = $item->excuseRequests->contains(fn ($appeal) => $appeal->status === 'pending')
            ? 'under_review'
            : ($item->excuseRequests->contains(fn ($appeal) => $appeal->status === 'approved') ? 'excused' : null);
        $complete = $requiredScans > 0 && $scansRecorded === $requiredScans;
        $attendanceStatus = $appealStatus
            ?? ($item->status === 'review_required'
                ? 'under_review'
                : ($requiredScans === 0
                    ? 'pending'
                    : ($complete
                        ? 'complete'
                        : ($scansRecorded === 0
                            ? ($event?->status === 'Completed' ? 'absent' : 'pending')
                            : 'incomplete'))));

        return [
            'reference' => $event?->reference,
            'title' => $event?->title,
            'event_date' => $event?->event_date?->format('Y-m-d'),
            'venue' => $event?->venue,
            'start_time' => $event?->start_time,
            'end_date' => $event?->end_date?->format('Y-m-d'),
            'end_time' => $event?->end_time,
            'event_status' => $event?->status,
            'target_role' => $event?->target_role,
            'target_department' => $event?->target_department,
            'target_course' => $event?->target_course,
            'target_year' => $event?->target_year,
            'attendance_status' => $attendanceStatus,
            'scans_recorded' => $scansRecorded,
            'required_scans' => $requiredScans,
            'status' => $attendanceStatus,
            'attendance' => $sessionRows->values(),
            'appeals' => $appeals,
            'appeal_status' => $appealStatus,
            'fine' => $item->fine ? $this->finePayload($item->fine) : null,
            'correction_deadline' => $event?->attendance_correction_deadline,
        ];
    }

    private function finePayload(StudentFine $fine): array
    {
        $fine->loadMissing(['obligation.event', 'payments']);
        $financiallyVisible = in_array($fine->assessment_status, ['approved', 'waived'], true);

        return [
            'id' => $fine->id,
            'amount' => $financiallyVisible ? $fine->amount : null,
            'reason' => $fine->reason,
            'assessment_status' => $fine->assessment_status,
            'payment_status' => $fine->payment_status,
            'amount_paid' => $financiallyVisible ? $fine->amount_paid : null,
            'outstanding_balance' => $fine->assessment_status === 'approved'
                ? max(0, (float) $fine->amount - (float) $fine->amount_paid)
                : ($fine->assessment_status === 'waived' ? 0 : null),
            'reviewed_at' => $fine->reviewed_at,
            'review_note' => $fine->review_note,
            'obligation' => $fine->obligation ? [
                'reference' => $fine->obligation->event?->reference,
                'title' => $fine->obligation->event?->title,
                'event_date' => $fine->obligation->event?->event_date?->format('Y-m-d'),
                'event' => [
                    'reference' => $fine->obligation->event?->reference,
                    'title' => $fine->obligation->event?->title,
                    'event_date' => $fine->obligation->event?->event_date?->format('Y-m-d'),
                ],
            ] : null,
            'payments' => $financiallyVisible ? $fine->payments->map(fn (FinePayment $payment) => [
                'amount' => $payment->amount,
                'receipt_reference' => $payment->receipt_reference,
                'method' => $payment->method,
                'paid_at' => $payment->paid_at,
                'note' => $payment->note,
            ])->values() : [],
        ];
    }
}
