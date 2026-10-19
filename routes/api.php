<?php

use App\Http\Controllers\Api\ActivityLogController;
use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AttendanceReportController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CertificateController;
use App\Http\Controllers\Api\CheckInController;
use App\Http\Controllers\Api\EvaluationController;
use App\Http\Controllers\Api\EventController;
use App\Http\Controllers\Api\EventScannerController;
use App\Http\Controllers\Api\RegistrationController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\StudentAttendanceController;
use App\Http\Controllers\Api\UserAccountController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('auth/admin-login', [AuthController::class, 'adminLogin'])->middleware('throttle:login');
Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:register');
Route::post('auth/forgot-password', [AuthController::class, 'sendPasswordResetLink'])->middleware('throttle:password-reset');
Route::post('auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:password-reset');
// Academic options are non-sensitive and needed by the public registration form.
Route::get('events/courses', [EventController::class, 'coursesIndex']);

// `active` re-checks the account status on every request, so an account that
// was suspended or deactivated after its token was issued is locked out
// instead of keeping access until the token expires.
Route::middleware(['auth:sanctum', 'active', 'throttle:api'])->group(function () {
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::get('auth/me', [AuthController::class, 'me']);
    Route::put('auth/profile', [AuthController::class, 'updateProfile']);

    Route::get('my/attendance-qr', [StudentAttendanceController::class, 'myQr']);
    Route::get('my/attendance', [StudentAttendanceController::class, 'obligations']);
    Route::get('my/announcements', [AnnouncementController::class, 'myAnnouncements']);
    Route::get('my/evaluations', [EvaluationController::class, 'myEvaluations'])
        ->middleware('role:evaluations');
    Route::get('my/attendance-fines/general-assembly', [StudentAttendanceController::class, 'generalAssemblyDetails']);
    Route::get('my/fines', [StudentAttendanceController::class, 'fines']);
    Route::get('my/fines/payment-options', [StudentAttendanceController::class, 'paymentOptions']);
    Route::post('my/attendance/{event}/appeals', [StudentAttendanceController::class, 'submitAppeal']);

    Route::put('settings/password', [SettingsController::class, 'updatePassword']);

    // Admin-only web management surface, gated by `requireAdmin`
    // (role === 'Admin', 403 otherwise). Management back office: settings,
    // accounts, audit-trail writes, announcement writes,
    // certificate issuance. Desk workflows and end-user reads stay OUTSIDE
    // under the existing EnsureRole matrix, so mobile is unaffected.
    Route::middleware('requireAdmin')->group(function () {
        Route::post('admin/events/{event}/attendance-roster/finalize', [StudentAttendanceController::class, 'finalizeRoster']);
        Route::get('admin/events/{event}/attendance-roster', [StudentAttendanceController::class, 'adminObligations']);
        Route::post('admin/events/{event}/assess-fines', [StudentAttendanceController::class, 'assess']);
        Route::patch('admin/fines/{fine}/review', [StudentAttendanceController::class, 'reviewFine']);
        Route::post('admin/fines/{fine}/payments', [StudentAttendanceController::class, 'recordPayment']);
        Route::patch('admin/attendance-appeals/{appeal}/review', [StudentAttendanceController::class, 'reviewAppeal']);
        Route::get('settings', [SettingsController::class, 'index']);
        Route::put('settings', [SettingsController::class, 'update']);
        Route::post('settings/logo', [SettingsController::class, 'uploadLogo']);

        // Evaluations are an optional admin review surface in the web app.
        Route::apiResource('evaluations', EvaluationController::class);

        Route::post('user-accounts/import', [UserAccountController::class, 'import']);
        // Step 1: account creation/deletion are admin-only, but self-service
        // password change must keep working for Staff. The update route sits
        // outside requireAdmin under role:user-accounts; the controller itself
        // re-gates it: non-admins may only change their OWN password (with
        // current_password), every other non-admin write 403s there.
        Route::post('user-accounts', [UserAccountController::class, 'store']);
        Route::delete('user-accounts/{user_account}', [UserAccountController::class, 'destroy']);

        Route::get('events/archived', [EventController::class, 'archivedIndex']);
        Route::post('events/{event}/archive', [EventController::class, 'archive']);
        Route::post('events/{event}/restore', [EventController::class, 'restore']);

        Route::apiResource('activity-logs', ActivityLogController::class)->except(['update']);

        Route::post('announcements', [AnnouncementController::class, 'store']);
        Route::put('announcements/{announcement}', [AnnouncementController::class, 'update']);
        Route::patch('announcements/{announcement}', [AnnouncementController::class, 'update']);
        Route::delete('announcements/{announcement}', [AnnouncementController::class, 'destroy']);

        Route::get('events/{event}/scanners', [EventScannerController::class, 'index']);
        Route::put('events/{event}/scanners', [EventScannerController::class, 'update']);
        Route::put('events/scanners/assign-all', [EventScannerController::class, 'assignToAllEvents']);

        Route::post('certificates/template', [CertificateController::class, 'uploadTemplate']);
        Route::get('certificates/templates', [CertificateController::class, 'templates']);
        Route::delete('certificates/templates/{event}', [CertificateController::class, 'destroyTemplate']);
        Route::post('certificates/eligible', [CertificateController::class, 'eligible']);
        Route::post('certificates/issue', [CertificateController::class, 'issue']);
        Route::post('certificates/send-bulk', [CertificateController::class, 'sendBulk']);
        Route::post('certificates/{certificate}/send', [CertificateController::class, 'send']);
        Route::post('certificates', [CertificateController::class, 'store']);
        Route::put('certificates/{certificate}', [CertificateController::class, 'update']);
        Route::patch('certificates/{certificate}', [CertificateController::class, 'update']);
        Route::delete('certificates/{certificate}', [CertificateController::class, 'destroy']);
    });

    Route::middleware('role:certificates')->group(function () {
        // Literal paths BEFORE the {certificate} wildcard: route matching
        // follows registration order, so a later show route would swallow
        // /certificates/templates and /preview|download as a lookup for a
        // certificate literally named "templates".
        Route::get('certificates/templates', [CertificateController::class, 'templates']);
        Route::get('certificates/{certificate}/preview', [CertificateController::class, 'preview']);
        Route::get('certificates/{certificate}/download', [CertificateController::class, 'download']);
        Route::get('certificates', [CertificateController::class, 'index']);
        Route::get('certificates/{certificate}', [CertificateController::class, 'show']);
    });

    // Mobile students submit feedback for events they registered for. The
    // student identity and event details are resolved from the token and
    // registration, while the existing /evaluations resource remains the
    // admin review surface.
    Route::post('evaluations/submit', [EvaluationController::class, 'submitStudent'])
        ->middleware('role:evaluations');

    // Only administrators and event-assigned scanners can open rosters or write
    // attendance. EventScannerAccess verifies the signed-in scanner's event
    // assignment on every roster/punch request.
    Route::middleware('role:checkin')->group(function () {
        Route::get('checkin/{token}', [CheckInController::class, 'show']);
        Route::post('checkin/{token}/punch', [CheckInController::class, 'punch']);
        Route::post('checkin/{token}/scan', [CheckInController::class, 'scan']);
        Route::post('checkin/{token}/mark', [CheckInController::class, 'mark']);
        Route::get('scanner/events', [EventScannerController::class, 'assignedEvents']);
        Route::get('scanner/history', [EventScannerController::class, 'history']);
        Route::get('scanner/summary', [EventScannerController::class, 'summary']);
    });

    // Reports are readable by Admin, Staff, and Organizer. Organizer results
    // are filtered to events they own by organizer_user_id in the controller.
    Route::middleware('role:reports')->group(function () {
        Route::get('reports', [ReportController::class, 'index']);
        Route::get('reports/summary', [ReportController::class, 'summary']);
        Route::get('events/{event}/attendance', [AttendanceReportController::class, 'index']);
    });

    // Scanner assignment and attendance-session configuration are admin-only.
    Route::middleware('requireAdmin')->group(function () {
        Route::get('events/{event}/checkin', [CheckInController::class, 'poster']);
        Route::get('events/{event}/sessions', [CheckInController::class, 'sessions']);
        Route::post('events/{event}/sessions', [CheckInController::class, 'storeSession']);
        Route::post('events/{event}/sessions/ensure', [CheckInController::class, 'ensureSessions']);

        Route::patch('sessions/{session}', [CheckInController::class, 'updateSession']);
        Route::post('sessions/{session}/close', [CheckInController::class, 'closeSession']);
        Route::post('sessions/{session}/reopen', [CheckInController::class, 'reopenSession']);
    });

    Route::get('events/{event}/eligibility', [EventController::class, 'eligibility'])
        ->middleware('role:registrations');
   Route::get('events', [EventController::class, 'index']);
    Route::get('events/{event}', [EventController::class, 'show']);

    Route::middleware('role:events')->group(function () {
        Route::post('events', [EventController::class, 'store']);
        Route::put('events/{event}', [EventController::class, 'update']);
        Route::patch('events/{event}', [EventController::class, 'update']);
        Route::delete('events/{event}', [EventController::class, 'destroy']);
        Route::post('events/{event}/banner', [EventController::class, 'uploadBanner']);
    });
    Route::middleware('role:announcements')->apiResource('announcements', AnnouncementController::class)->only(['index', 'show']);
    Route::middleware('role:user-accounts')->group(function () {
        Route::get('user-accounts', [UserAccountController::class, 'index']);
        Route::get('user-accounts/{user_account}', [UserAccountController::class, 'show']);
        Route::put('user-accounts/{user_account}', [UserAccountController::class, 'update']);
        Route::patch('user-accounts/{user_account}', [UserAccountController::class, 'update']);
    });
    Route::middleware('role:registrations')->group(function () {
        // Literal path BEFORE the {registration} apiResource wildcard so that
        // /registrations/{reference}/calendar is not treated as a show lookup.
        Route::get('registrations/{registration}/calendar', [RegistrationController::class, 'calendar']);
    });
    Route::delete('registrations/{registration}/cancel', [RegistrationController::class, 'cancelStudent']);
    // Declared before the resource so these match on their own literal paths
    // rather than being at the mercy of the {registration} wildcard.
    Route::middleware('role:registrations')->group(function () {
        Route::post('registrations/send-reminders', [RegistrationController::class, 'sendReminders']);
    });

    // Student routes are ownership-scoped in RegistrationController. This
    // static route must precede the resource's {registration} show route.
    Route::post('registrations/self', [RegistrationController::class, 'selfRegister']);
    Route::get('registrations/my', [RegistrationController::class, 'myRegistrations']);

    Route::middleware('role:registrations')->apiResource('registrations', RegistrationController::class);
    Route::middleware('role:activity-logs')->apiResource('activity-logs', ActivityLogController::class)->only(['index', 'show']);
});
