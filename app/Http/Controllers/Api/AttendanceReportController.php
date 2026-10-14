<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceSession;
use App\Models\Event;
use App\Models\Attendance;
use App\Models\Registration;
use App\Services\AttendanceRecorder;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;

class AttendanceReportController extends Controller
{
    public function __construct(
        private readonly AttendanceRecorder $recorder,
    ) {
    }

    public function index(Event $event)
    {
        $payload = $this->rosterPayload($event);

        return response()->json($payload);
    }

    /** Build the whole roster in a fixed number of queries. */
    private function rosterPayload(Event $event): array
    {
        $event->loadMissing('attendanceSessions');

        $sessions = $event->attendanceSessions;
        $sessionIds = $sessions->pluck('id');

        $registrations = $event->registrations()->orderBy('participant')->get();

        $punches = DB::table('attendances')
            ->whereIn('attendance_session_id', $sessionIds)
            ->whereIn('registration_id', $registrations->pluck('id'))
            ->get(['attendance_session_id', 'registration_id', 'time_in', 'time_out', 'status'])
            ->keyBy(fn ($row) => $row->attendance_session_id.':'.$row->registration_id);

        $roster = $registrations->map(function (Registration $registration) use ($sessions, $punches) {
            $perSession = [];

            foreach ($sessions as $session) {
                $punch = $punches->get($session->id.':'.$registration->id);

                $perSession[(string) $session->id] = [
                    'time_in' => $punch ? $punch->time_in : null,
                    'time_out' => $punch ? $punch->time_out : null,
                    'status' => $punch ? $punch->status : Attendance::NOT_RECORDED,
                    'complete' => $punch !== null && $punch->time_in !== null && $punch->time_out !== null,
                ];
            }

            $complete = (new SupportCollection($perSession))->filter(fn ($s) => $s['complete'])->count();

            return [
                'registration_id' => $registration->id,
                'reference' => $registration->reference,
                'participant' => $registration->participant,
                'email' => $registration->email,
                'role' => $registration->role,
                'block_no' => $registration->block_no,
                'attendance' => $registration->attendance,
                'sessions_complete' => $complete,
                'sessions_total' => $sessions->count(),
                'sessions' => $perSession,
            ];
        });

        return [
            'event' => [
                'reference' => $event->reference,
                'title' => $event->title,
                'event_date' => $event->event_date ? $event->event_date->format('Y-m-d') : null,
                'venue' => $event->venue,
            ],
            'sessions' => $sessions->map(fn ($s) => $this->sessionPayload($s)),
            'roster' => $roster,
            'counts' => [
                'registered' => $roster->count(),
                'fully_recorded' => $roster->filter(fn ($r) => $r['sessions_complete'] === $r['sessions_total'] && $r['sessions_total'] > 0)->count(),
            ],
        ];
    }

    private function sessionPayload(AttendanceSession $session): array
    {
        return [
            'id' => $session->id,
            'label' => $session->label,
            'session_date' => $session->session_date ? $session->session_date->format('Y-m-d') : null,
            'time_in' => $session->time_in,
            'time_out' => $session->time_out,
            'status' => $session->status,
            'grace_minutes' => $session->grace_minutes,
            'complete' => $session->attendances->every(fn ($a) => $a->isComplete()),
        ];
    }
}
