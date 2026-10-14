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
use App\Http\Controllers\Api\UserAccountController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('auth/admin-login', [AuthController::class, 'adminLogin'])->middleware('throttle:login');
Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:register');

// `active` re-checks the account status on every request, so an account that
// was suspended or deactivated after its token was issued is locked out
// instead of keeping access until the token expires.
Route::middleware(['auth:sanctum', 'active', 'throttle:api'])->group(function () {
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::get('auth/me', [AuthController::class, 'me']);

    Route::put('settings/password', [SettingsController::class, 'updatePassword']);

    // Step 1 — admin-only web management surface, gated by `requireAdmin`
    // (role === 'Admin', 403 otherwise). Management back office: settings,
    // reports, accounts, audit-trail writes, event/announcement writes,
    // certificate issuance. Desk workflows and end-user reads stay OUTSIDE
    // under the existing EnsureRole matrix, so mobile is unaffected.
    Route::middleware('requireAdmin')->group(function () {
        Route::get('settings', [SettingsController::class, 'index']);
        Route::put('settings', [SettingsController::class, 'update']);
        Route::post('settings/logo', [SettingsController::class, 'uploadLogo']);

        Route::get('reports', [ReportController::class, 'index']);
        Route::get('reports/summary', [ReportController::class, 'summary']);

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

        Route::apiResource('activity-logs', ActivityLogController::class)->except(['update']);

        Route::post('announcements', [AnnouncementController::class, 'store']);
        Route::put('announcements/{announcement}', [AnnouncementController::class, 'update']);
        Route::patch('announcements/{announcement}', [AnnouncementController::class, 'update']);
        Route::delete('announcements/{announcement}', [AnnouncementController::class, 'destroy']);

        Route::get('events/{event}/scanners', [EventScannerController::class, 'index']);
        Route::put('events/{event}/scanners', [EventScannerController::class, 'update']);

        Route::get('events/{event}/attendance', [AttendanceReportController::class, 'index']);

        Route::post('events', [EventController::class, 'store']);
        Route::put('events/{event}', [EventController::class, 'update']);
        Route::patch('events/{event}', [EventController::class, 'update']);
        Route::delete('events/{event}', [EventController::class, 'destroy']);

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

    // Only administrators and event-assigned scanners can open rosters or write
    // attendance. The event QR resolves a target; EventScannerAccess verifies
    // the signed-in scanner's event assignment on every roster/punch request.
    Route::middleware('role:checkin')->group(function () {
        Route::get('checkin/{token}', [CheckInController::class, 'show']);
        Route::post('checkin/{token}/punch', [CheckInController::class, 'punch']);
        Route::post('checkin/{token}/scan', [CheckInController::class, 'scan']);
        Route::post('checkin/{token}/mark', [CheckInController::class, 'mark']);
        Route::get('scanner/events', [EventScannerController::class, 'assignedEvents']);
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

    Route::get('events/courses', [EventController::class, 'coursesIndex']);
    Route::middleware('role:events')->apiResource('events', EventController::class)->only(['index', 'show']);
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
    // Declared before the resource so these match on their own literal paths
    // rather than being at the mercy of the {registration} wildcard.
    Route::middleware('role:registrations')->group(function () {
        Route::post('registrations/send-reminders', [RegistrationController::class, 'sendReminders']);
    });

    // Student routes are ownership-scoped in RegistrationController. This
    // static route must precede the resource's {registration} show route.
    Route::post('registrations/self', [RegistrationController::class, 'selfRegister']);

    Route::middleware('role:registrations')->apiResource('registrations', RegistrationController::class);
    Route::middleware('role:activity-logs')->apiResource('activity-logs', ActivityLogController::class)->only(['index', 'show']);
});
