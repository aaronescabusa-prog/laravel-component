<?php

use App\Jobs\SendCertificateMail;
use App\Mail\CertificateMail;
use App\Models\Certificate;
use App\Models\CertificateTemplate;
use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Services\CertificateEligibility;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function certAdmin(): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-CERT-ADMIN', 'name' => 'Cert Admin',
        'email' => 'cert-admin@tmc.test', 'role' => 'Admin',
        'status' => 'Active', 'password' => 'password',
    ]);
}

function certStudent(string $reference = 'USR-STU-1'): UserAccount
{
    return UserAccount::create([
        'reference' => $reference, 'name' => 'Student', 'email' => strtolower($reference).'@tmc.test',
        'role' => 'Student', 'status' => 'Active', 'password' => 'password',
    ]);
}

function makeEvent(array $overrides = []): Event
{
    return Event::create(array_merge([
        'reference' => 'EVE-CERT-1', 'title' => 'IT Congress', 'category' => 'Seminar',
        'event_date' => '2026-10-01', 'status' => 'Completed', 'has_certificate' => true,
    ], $overrides));
}

/**
 * Give an event its morning and afternoon windows.
 *
 * Certificate eligibility is strict — a participant needs a time-in AND a
 * time-out on every session — so a fixture that only sets the legacy
 * `attendance` column would make everybody ineligible.
 */
function makeSessions(Event $event): void
{
    app(\App\Services\EventSchedule::class)->ensureSessions($event);
}

/**
 * @param  string  $attendance  Present, Late, Absent, Excused or Not Yet Recorded
 */
function makeRegistration(string $eventTitle, string $participant, string $attendance, int $seq): Registration
{
    $event = Event::where('title', $eventTitle)->firstOrFail();

    makeSessions($event);

    // forceCreate: event_id is server-derived and therefore not mass-assignable.
    $registration = Registration::forceCreate([
        'reference' => 'TMC-'.$seq, 'participant' => $participant,
        'email' => strtolower(str_replace(' ', '.', $participant)).'@student.tmc.test',
        'event' => $eventTitle, 'event_id' => $event->id,
        'payment' => '100', 'payment_status' => 'Paid',
        'attendance' => $attendance, 'reg_date' => '2026-10-01',
    ]);

    // Mirror the requested outcome onto every session so the fixture matches
    // what the recorder would actually have produced.
    $punched = in_array($attendance, ['Present', 'Late'], true);

    foreach ($event->attendanceSessions()->get() as $session) {
        \App\Models\Attendance::create([
            'attendance_session_id' => $session->id,
            'registration_id' => $registration->id,
            'time_in' => $punched ? $session->session_date->format('Y-m-d').' 08:00:00' : null,
            'time_out' => $punched ? $session->session_date->format('Y-m-d').' 12:00:00' : null,
            'status' => $attendance,
            'recorded_at' => $punched ? now() : null,
            'recorded_by' => $punched ? 'test' : null,
        ]);
    }

    return $registration;
}

/**
 * A fake uploaded image.
 *
 * Uses create() rather than image() because UploadedFile::fake()->image()
 * needs the GD extension, which is not guaranteed to be installed. The mime
 * type is declared explicitly so the mimes: validation rule still runs.
 */
function fakeTemplate(string $name = 'template.jpg'): UploadedFile
{
    return UploadedFile::fake()->create($name, 120, 'image/jpeg');
}

function makeCertificate(string $reference, string $participant, string $event = 'IT Congress'): Certificate
{
    return Certificate::create([
        'reference' => $reference, 'participant' => $participant,
        'email' => strtolower(str_replace(' ', '.', $participant)).'@student.tmc.test',
        'event' => $event, 'status' => 'Pending',
    ]);
}

/* ------------------------------------------------------------- eligibility */

test('only students punched in and out for every session are eligible', function () {
    $event = makeEvent();

    makeRegistration($event->title, 'Ana Cruz', 'Present', 1);
    makeRegistration($event->title, 'Ben Diaz', 'Late', 2);
    makeRegistration($event->title, 'Cara Garcia', 'Excused', 3);
    makeRegistration($event->title, 'Dan Reyes', 'Absent', 4);
    makeRegistration($event->title, 'Eve Santos', 'Not Yet Recorded', 5);

    $rows = app(CertificateEligibility::class)->forEvent($event);

    expect($rows)->toHaveCount(5);

    $byName = $rows->keyBy('participant');

    expect($byName['Ana Cruz']['eligible'])->toBeTrue()
        ->and($byName['Ben Diaz']['eligible'])->toBeTrue()
        // Excused leaves both punches null, so the strict rule excludes it. This
        // is a deliberate consequence of "in and out on every session".
        ->and($byName['Cara Garcia']['eligible'])->toBeFalse()
        ->and($byName['Cara Garcia']['reason'])->toContain('Excused')
        ->and($byName['Dan Reyes']['eligible'])->toBeFalse()
        ->and($byName['Dan Reyes']['reason'])->toContain('absent')
        ->and($byName['Eve Santos']['eligible'])->toBeFalse()
        ->and($byName['Eve Santos']['reason'])->toContain('not been recorded');
});

test('an event that issues no certificates makes nobody eligible', function () {
    $event = makeEvent(['has_certificate' => false]);
    makeRegistration($event->title, 'Ana Cruz', 'Present', 1);

    $rows = app(CertificateEligibility::class)->forEvent($event);

    expect($rows)->toHaveCount(1)
        ->and($rows->first()['eligible'])->toBeFalse()
        ->and($rows->first()['reason'])->toContain('does not issue certificates');
});

test('the eligible endpoint reports counts and reasons', function () {
    $event = makeEvent();
    makeRegistration($event->title, 'Ana Cruz', 'Present', 1);
    makeRegistration($event->title, 'Dan Reyes', 'Absent', 2);

    Sanctum::actingAs(certAdmin());

    $this->postJson('/api/certificates/eligible', ['event' => $event->title])
        ->assertOk()
        ->assertJson([
            'event' => 'IT Congress',
            'issues_certificates' => true,
            'total' => 2,
            'eligible_count' => 1,
        ]);
});

/* ---------------------------------------------------------------- issuing */

test('issuing creates pending certificates only for eligible students', function () {
    $event = makeEvent();
    makeRegistration($event->title, 'Ana Cruz', 'Present', 1);
    makeRegistration($event->title, 'Dan Reyes', 'Absent', 2);

    $issued = app(CertificateEligibility::class)->issueForEvent($event);

    expect($issued)->toHaveCount(1)
        ->and(Certificate::count())->toBe(1);

    $certificate = Certificate::first();

    expect($certificate->participant)->toBe('Ana Cruz')
        ->and($certificate->status)->toBe('Pending')
        ->and($certificate->send_status)->toBe('Not Sent');
});

test('issuing twice does not duplicate certificates', function () {
    $event = makeEvent();
    makeRegistration($event->title, 'Ana Cruz', 'Present', 1);

    $eligibility = app(CertificateEligibility::class);
    $eligibility->issueForEvent($event);
    $eligibility->issueForEvent($event);

    expect(Certificate::count())->toBe(1);
});

/* -------------------------------------------------------------- templates */

test('an admin can upload a certificate template', function () {
    Storage::fake('public');
    Sanctum::actingAs(certAdmin());

    $this->postJson('/api/certificates/template', [
        'event' => 'IT Congress',
        'name' => 'Congress 2026',
        'template' => fakeTemplate(),
    ])->assertCreated()
        ->assertJson([
            'event' => 'IT Congress',
            'name' => 'Congress 2026',
        ]);

    expect(CertificateTemplate::count())->toBe(1);

    Storage::disk('public')->assertExists(CertificateTemplate::first()->path);
});

test('the templates listing is not swallowed by the resource show route', function () {
    Storage::fake('public');
    Sanctum::actingAs(certAdmin());

    $this->postJson('/api/certificates/template', [
        'event' => 'IT Congress',
        'template' => fakeTemplate(),
    ])->assertCreated();

    // GET /api/certificates/templates must reach templates(), not the
    // apiResource show route, which would look for a certificate whose
    // reference is literally "templates" and 404 - hiding the artwork.
    $this->getJson('/api/certificates/templates')
        ->assertOk()
        ->assertJsonCount(1)
        ->assertJsonPath('0.event', 'IT Congress')
        // The preview needs a resolvable URL, not just the stored path.
        ->assertJsonStructure([['event', 'name', 'path', 'width', 'height', 'url']]);

    // The wildcard still works for a real reference.
    Certificate::create([
        'reference' => 'CERT-ROUTES',
        'participant' => 'Ana Reyes',
        'email' => 'ana@tmc.edu.ph',
        'event' => 'IT Congress',
    ]);

    $this->getJson('/api/certificates/CERT-ROUTES')
        ->assertOk()
        ->assertJsonPath('reference', 'CERT-ROUTES');
});

test('uploading a second template for the same event replaces the first', function () {
    Storage::fake('public');
    Sanctum::actingAs(certAdmin());

    $this->postJson('/api/certificates/template', [
        'event' => 'IT Congress',
        'template' => fakeTemplate('first.jpg'),
    ])->assertCreated();

    $first = CertificateTemplate::first()->path;

    $this->postJson('/api/certificates/template', [
        'event' => 'IT Congress',
        'template' => fakeTemplate('second.jpg'),
    ])->assertCreated();

    expect(CertificateTemplate::count())->toBe(1)
        ->and(CertificateTemplate::first()->path)->not->toBe($first);

    Storage::disk('public')->assertMissing($first);
});

test('a non-image template is rejected', function () {
    Storage::fake('public');
    Sanctum::actingAs(certAdmin());

    $this->postJson('/api/certificates/template', [
        'event' => 'IT Congress',
        'template' => UploadedFile::fake()->create('payload.pdf', 100, 'application/pdf'),
    ])->assertStatus(422);

    expect(CertificateTemplate::count())->toBe(0);
});

test('a student cannot upload a certificate template', function () {
    Storage::fake('public');
    Sanctum::actingAs(certStudent());

    $this->postJson('/api/certificates/template', [
        'event' => 'IT Congress',
        'template' => fakeTemplate(),
    ])->assertForbidden();
});

/* ----------------------------------------------------------------- render */

test('a certificate renders to a real pdf', function () {
    $certificate = makeCertificate('CERT-TMC-1', 'Ana Cruz');

    Sanctum::actingAs(certAdmin());

    $response = $this->get('/api/certificates/'.$certificate->reference.'/preview');

    $response->assertOk();
    expect($response->headers->get('Content-Type'))->toContain('application/pdf');

    $pdf = (string) $response->getContent();

    expect(substr($pdf, 0, 5))->toBe('%PDF-')
        ->and(strlen($pdf))->toBeGreaterThan(1000);
});

/* ------------------------------------------------------------------- send */

test('sending queues a job and marks the certificate queued', function () {
    Queue::fake();

    $certificate = makeCertificate('CERT-TMC-2', 'Ben Diaz');

    Sanctum::actingAs(certAdmin());

    $this->post('/api/certificates/'.$certificate->reference.'/send')
        ->assertStatus(202)
        ->assertJson(['send_status' => 'Queued']);

    Queue::assertPushed(SendCertificateMail::class, 1);

    expect($certificate->fresh()->send_status)->toBe('Queued');
});

test('bulk sending queues one job per certificate', function () {
    Queue::fake();

    $references = collect(range(1, 3))
        ->map(fn (int $i) => makeCertificate('CERT-BULK-'.$i, 'Student '.$i)->reference)
        ->all();

    Sanctum::actingAs(certAdmin());

    $this->post('/api/certificates/send-bulk', ['references' => $references])
        ->assertStatus(202)
        ->assertJson(['queued' => 3]);

    Queue::assertPushed(SendCertificateMail::class, 3);
});

test('the job renders, emails and marks the certificate sent', function () {
    Mail::fake();
    Storage::fake('public');

    $certificate = makeCertificate('CERT-TMC-3', 'Cara Garcia');

    (new SendCertificateMail($certificate->id))->handle(app(\App\Services\CertificateRenderer::class));

    Mail::assertSent(CertificateMail::class, 1);

    $fresh = $certificate->fresh();

    expect($fresh->status)->toBe('Issued')
        ->and($fresh->send_status)->toBe('Sent')
        ->and($fresh->sent_at)->not->toBeNull()
        ->and($fresh->sent_to)->toBe('cara.garcia@student.tmc.test');

    Storage::disk('public')->assertExists('certificates/CERT-TMC-3.pdf');
});

test('the mail attaches the rendered pdf', function () {
    Mail::fake();
    Storage::fake('public');

    $certificate = makeCertificate('CERT-TMC-4', 'Dan Reyes');

    $renderer = app(\App\Services\CertificateRenderer::class);
    $path = $renderer->store($certificate);

    $mail = new CertificateMail($certificate, $path);

    expect($mail->attachments())->toHaveCount(1)
        ->and($mail->envelope()->subject)->toContain('IT Congress');
});

test('a student without a valid email fails without being retried', function () {
    Mail::fake();

    $certificate = Certificate::create([
        'reference' => 'CERT-TMC-5', 'participant' => 'Eve Santos',
        'email' => 'not-an-email', 'event' => 'IT Congress', 'status' => 'Pending',
    ]);

    (new SendCertificateMail($certificate->id))->handle(app(\App\Services\CertificateRenderer::class));

    Mail::assertNothingSent();

    expect($certificate->fresh()->send_status)->toBe('Failed');
});

/* ------------------------------------------------------------ permissions */

test('a student cannot send a certificate', function () {
    Queue::fake();

    $certificate = makeCertificate('CERT-TMC-6', 'Ana Cruz');

    Sanctum::actingAs(certStudent('USR-STU-2'));

    $this->post('/api/certificates/'.$certificate->reference.'/send')->assertForbidden();

    Queue::assertNothingPushed();
});

/* ----------------------------------------------------------------- download */

test('a certificate can be downloaded as a file', function () {
    $certificate = makeCertificate('CERT-DL-1', 'Ana Cruz');

    Sanctum::actingAs(certAdmin());

    $response = $this->get('/api/certificates/'.$certificate->reference.'/download');

    $response->assertOk();

    expect($response->headers->get('Content-Type'))->toContain('application/pdf')
        // attachment, not inline: the browser has to save it rather than try to
        // display a PDF in the tab.
        ->and($response->headers->get('Content-Disposition'))->toContain('attachment')
        ->and($response->headers->get('Content-Disposition'))->toContain('CERT-DL-1.pdf')
        ->and(substr((string) $response->getContent(), 0, 5))->toBe('%PDF-');
});

test('downloading a certificate leaves no file behind on disk', function () {
    Storage::fake('public');

    $certificate = makeCertificate('CERT-DL-2', 'Ana Cruz');

    Sanctum::actingAs(certAdmin());

    $this->get('/api/certificates/'.$certificate->reference.'/download')->assertOk();

    // Rendered per request rather than cached, so a download cannot pile up a
    // PDF that nothing ever deletes.
    expect(Storage::disk('public')->files('certificates'))->toBe([]);
});

test('a student may download their own certificate, matching the existing read permission', function () {
    $student = certStudent('USR-STU-3');

    Certificate::create([
        'reference' => 'CERT-DL-3', 'participant' => $student->name,
        'email' => $student->email,
        'event' => 'IT Congress', 'status' => 'Pending',
    ]);

    Sanctum::actingAs($student);

    // Certificates grant `read` to Student and the gate keys off the HTTP verb,
    // so a GET is a read. Download therefore has the same reach as the existing
    // index and preview endpoints rather than being stricter than they are.
    $this->get('/api/certificates/CERT-DL-3/download')
        ->assertOk()
        ->assertHeader('Content-Type', 'application/pdf');
});

test("a student cannot download another student's certificate", function () {
    $certificate = makeCertificate('CERT-DL-4', 'Ana Cruz');

    Sanctum::actingAs(certStudent('USR-STU-4'));

    // Owner scoping hides other students' rows the same way the listing and
    // show endpoints do: a 404, not a 403, so membership is not leaked.
    $this->get('/api/certificates/'.$certificate->reference.'/download')
        ->assertNotFound();
});

/* -------------------------------------------------------------------- queue */

test('the certificate job lands on the queue a plain worker consumes', function () {
    // Regression guard. This job used to target a dedicated "mail" queue that
    // nothing ever consumed, so `php artisan queue:work` silently ignored it and
    // every certificate sat on "Queued" forever with no error anywhere.
    Queue::fake();

    $certificate = makeCertificate('CERT-Q-1', 'Ana Cruz');

    Sanctum::actingAs(certAdmin());

    $this->post('/api/certificates/'.$certificate->reference.'/send')->assertStatus(202);

    Queue::assertPushed(SendCertificateMail::class, function (SendCertificateMail $job) {
        expect($job->queue)->toBeNull();

        return true;
    });
});
