<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SendCertificateMail;
use App\Models\Certificate;
use App\Models\CertificateTemplate;
use App\Models\Event;
use App\Models\UserAccount;
use App\Services\CertificateEligibility;
use App\Services\CertificateRenderer;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class CertificateController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Certificate::query();

        // The Student role may read certificates, so the listing is narrowed to
        // the caller's own rows. Staff and above keep the full register.
        $this->restrictToOwner($query, $request->user());

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('participant', 'like', "%{$term}%")
                    ->orWhere('event', 'like', "%{$term}%")
                    ->orWhere('reference', 'like', "%{$term}%");
            });
        }

        if ($request->filled('status')) {
            $query->where('status', $request->string('status')->toString());
        }

        if ($request->filled('send_status')) {
            $query->where('send_status', $request->string('send_status')->toString());
        }

        return response()->json($query->orderByDesc('id')->paginate(
            $this->perPage($request)
        ));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'reference' => ['required', 'string', 'max:50', Rule::unique('certificates', 'reference')],
            'participant' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'event' => ['required', 'string', 'max:255'],
            'status' => ['required', 'string', Rule::in(['Issued', 'Pending', 'Not Eligible'])],
            'date_issued' => ['nullable', 'string', 'max:20'],
            'qr_code' => ['nullable', 'string', 'max:100'],
        ]);

        $certificate = Certificate::create($validated);

        return response()->json($certificate, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, Certificate $certificate)
    {
        $this->assertVisibleTo($request, $certificate);

        return response()->json($certificate);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Certificate $certificate)
    {
        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('certificates', 'reference')->ignore($certificate->id)],
            'participant' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255'],
            'event' => ['sometimes', 'required', 'string', 'max:255'],
            'status' => ['sometimes', 'required', 'string', Rule::in(['Issued', 'Pending', 'Not Eligible'])],
            'date_issued' => ['nullable', 'string', 'max:20'],
            'qr_code' => ['nullable', 'string', 'max:100'],
        ]);

        $certificate->update($validated);

        return response()->json($certificate->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Certificate $certificate)
    {
        $certificate->delete();

        return response()->noContent();
    }

    /**
     * Narrow certificate reads to the caller's own rows for the Student role.
     *
     * Students may read certificates (see EnsureRole) but must only ever see
     * their own; the email is the link between an account and the certificates
     * issued to it.
     */
    private function restrictToOwner($query, ?UserAccount $user): void
    {
        if ($this->isStudent($user)) {
            $query->whereRaw('LOWER(email) = ?', [mb_strtolower(trim((string) $user->email))]);
        }
    }

    /** Abort with a 404 when a Student asks for a certificate that is not theirs. */
    private function assertVisibleTo(Request $request, Certificate $certificate): void
    {
        $user = $request->user();

        if (! $this->isStudent($user)) {
            return;
        }

        abort_unless(
            mb_strtolower(trim((string) $certificate->email)) === mb_strtolower(trim((string) $user->email)),
            404,
        );
    }

    private function isStudent(?UserAccount $user): bool
    {
        return $user !== null && $user->role === 'Student';
    }

    /* ------------------------------------------------------------------ *
     *  Template upload / eligibility / issue / send
     * ------------------------------------------------------------------ */

    /**
     * Upload the certificate artwork for an event.
     *
     * Re-uploading for the same event replaces the previous file so a
     * correction never leaves two competing templates behind.
     */
    public function uploadTemplate(Request $request)
    {
        $validated = $request->validate([
            'event' => ['required', 'string', 'max:255'],
            'name' => ['nullable', 'string', 'max:255'],
            'template' => ['required', 'file', 'mimes:png,jpg,jpeg', 'max:5120'],
        ]);

        $file = $request->file('template');
        $event = $validated['event'];
        [$width, $height] = $this->imageDimensions($file);

        $existing = CertificateTemplate::where('event', $event)->first();

        if ($existing) {
            Storage::disk('public')->delete($existing->path);
        }

        $template = CertificateTemplate::updateOrCreate(
            ['event' => $event],
            [
                // `nullable` does not guarantee the key is present, so read it
                // defensively before falling back to the uploaded filename.
                'name' => ($validated['name'] ?? null) ?: $file->getClientOriginalName(),
                'path' => $file->store('certificate-templates', 'public'),
                'width' => $width,
                'height' => $height,
            ]
        );

        return response()->json($template, 201);
    }

    /**
     * Pixel dimensions of an uploaded image, used to size the PDF page so the
     * artwork is not stretched.
     *
     * getimagesize() only reads the file header, so it works without the GD
     * extension. Falls back to A4 landscape @96dpi when it cannot be read.
     *
     * @return array{0: int, 1: int}
     */
    private function imageDimensions(UploadedFile $file): array
    {
        $size = @getimagesize($file->getRealPath());

        if ($size === false) {
            return [1123, 794];
        }

        return [(int) $size[0], (int) $size[1]];
    }

    /**
     * List the uploaded templates.
     */
    public function templates()
    {
        return response()->json(CertificateTemplate::orderBy('event')->get());
    }

    /**
     * Delete the template for an event.
     */
    public function destroyTemplate(string $event)
    {
        $template = CertificateTemplate::where('event', $event)->firstOrFail();

        Storage::disk('public')->delete($template->path);
        $template->delete();

        return response()->noContent();
    }

    /**
     * "# view student eligible" — who may receive a certificate for an event,
     * and who is excluded and why.
     */
    public function eligible(Request $request, CertificateEligibility $eligibility)
    {
        $validated = $request->validate([
            'event' => ['required', 'string', 'max:255'],
        ]);

        $event = Event::where('title', $validated['event'])->firstOrFail();

        $rows = $eligibility->forEvent($event);

        return response()->json([
            'event' => $event->title,
            'issues_certificates' => (bool) $event->has_certificate,
            'total' => $rows->count(),
            'eligible_count' => $rows->where('eligible', true)->count(),
            'rows' => $rows,
        ]);
    }

    /**
     * Create Pending certificate rows for the eligible students of an event
     * without sending anything. This is the confirmation step.
     */
    public function issue(Request $request, CertificateEligibility $eligibility)
    {
        $validated = $request->validate([
            'event' => ['required', 'string', 'max:255'],
        ]);

        $event = Event::where('title', $validated['event'])->firstOrFail();

        $issued = $eligibility->issueForEvent($event);

        return response()->json([
            'event' => $event->title,
            'issued_count' => $issued->count(),
            'certificates' => $issued,
        ]);
    }

    /**
     * Queue a single certificate email.
     */
    public function send(Request $request, Certificate $certificate)
    {
        $template = CertificateTemplate::where('event', $certificate->event)->first();

        SendCertificateMail::dispatch($certificate->id, $template?->id);

        $certificate->update(['send_status' => 'Queued']);

        return response()->json([
            'message' => 'Certificate queued for delivery.',
            'send_status' => $certificate->fresh()->send_status,
        ], 202);
    }

    /**
     * Queue certificate emails for many students at once.
     *
     * Capped at 500 per call so one request cannot flood the queue (and the
     * Gmail daily quota) in a single click.
     */
    public function sendBulk(Request $request)
    {
        $validated = $request->validate([
            'references' => ['required', 'array', 'min:1', 'max:500'],
            'references.*' => ['required', 'string', 'max:50', 'exists:certificates,reference'],
        ]);

        $certificates = Certificate::whereIn('reference', $validated['references'])->get();

        foreach ($certificates as $certificate) {
            $template = CertificateTemplate::where('event', $certificate->event)->first();

            SendCertificateMail::dispatch($certificate->id, $template?->id);

            $certificate->update(['send_status' => 'Queued']);
        }

        return response()->json([
            'message' => 'Queued '.$certificates->count().' certificate(s) for delivery.',
            'queued' => $certificates->count(),
        ], 202);
    }

    /**
     * Render a certificate to PDF on demand so an administrator can preview or
     * print before anything is emailed.
     */
    public function preview(Request $request, Certificate $certificate, CertificateRenderer $renderer)
    {
        $this->assertVisibleTo($request, $certificate);

        $template = CertificateTemplate::where('event', $certificate->event)->first();

        $pdf = $renderer->render($certificate, $template);

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="'.$certificate->reference.'.pdf"',
        ]);
    }

    /**
     * The same render as preview(), served as a file the browser saves rather
     * than one it tries to display in a tab.
     *
     * Rendered fresh per request instead of being read back from the public disk.
     * The stored copy exists only to be attached to an email, so reading it back
     * would mean a download quietly depends on somebody having pressed Send
     * first, and would pile up another PDF that nothing ever cleans up.
     */
    public function download(Request $request, Certificate $certificate, CertificateRenderer $renderer)
    {
        $this->assertVisibleTo($request, $certificate);

        $template = CertificateTemplate::where('event', $certificate->event)->first();

        $pdf = $renderer->render($certificate, $template);

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$certificate->reference.'.pdf"',
            'Content-Length' => (string) strlen($pdf),
        ]);
    }
}
