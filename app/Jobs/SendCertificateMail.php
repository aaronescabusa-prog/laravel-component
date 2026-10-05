<?php

namespace App\Jobs;

use App\Mail\CertificateMail;
use App\Models\Certificate;
use App\Models\CertificateTemplate;
use App\Services\CertificateRenderer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

/**
 * Renders a certificate and emails it to the student.
 *
 * Queued rather than sent inline so a batch of hundreds of students does not
 * exceed the web request timeout, and so one bad address cannot take down the
 * whole run: `tries` retries transient failures and the final failure is
 * recorded on the certificate instead of vanishing.
 *
 * Note there is deliberately no onQueue() call here. This job used to target a
 * dedicated "mail" queue, but nothing ever consumed that name, so a plain
 * `php artisan queue:work` left every certificate stuck on "Queued" with no
 * error anywhere - a silent failure that looked like a successful send. Staying
 * on the default queue means the documented command actually works.
 */
class SendCertificateMail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Give up after this many attempts. */
    public int $tries = 3;

    /** Back off between retries so a rate-limited mailbox is not hammered. */
    public int $backoff = 60;

    /** A batch should not hold a worker for ten minutes. */
    public int $timeout = 120;

    public function __construct(
        public int $certificateId,
        public ?int $templateId = null,
    ) {
    }

    public function handle(CertificateRenderer $renderer): void
    {
        $certificate = Certificate::withTrashed()->find($this->certificateId);

        if (! $certificate) {
            Log::warning('SendCertificateMail: certificate missing', ['id' => $this->certificateId]);

            return;
        }

        // An address we cannot deliver to is a permanent failure, not a
        // transient one: retrying a malformed address just burns the quota.
        if (blank($certificate->email) || ! filter_var($certificate->email, FILTER_VALIDATE_EMAIL)) {
            $certificate->update([
                'send_status' => 'Failed',
                'send_error' => 'No valid email address on file.',
            ]);

            Log::warning('SendCertificateMail: invalid email', [
                'certificate_id' => $certificate->id,
                'reference' => $certificate->reference,
                'email' => $certificate->email,
            ]);

            return;
        }

        $template = $this->templateId
            ? CertificateTemplate::find($this->templateId)
            : CertificateTemplate::where('event', $certificate->event)->first();

        try {
            $pdfPath = $renderer->store($certificate, $template);
        } catch (\Throwable $e) {
            $certificate->update([
                'send_status' => 'Failed',
                'send_error' => 'Failed to render certificate: '.$e->getMessage(),
            ]);

            Log::error('SendCertificateMail: render failed', [
                'certificate_id' => $certificate->id,
                'reference' => $certificate->reference,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }

        $certificate->update([
            'status' => 'Issued',
            'date_issued' => $certificate->date_issued ?: now()->format('Y-m-d'),
            'send_status' => 'Sending',
            'sent_to' => $certificate->email,
        ]);

        Log::info('SendCertificateMail: sending', [
            'certificate_id' => $certificate->id,
            'reference' => $certificate->reference,
            'email' => $certificate->email,
            'pdf_path' => $pdfPath,
        ]);

        Mail::to($certificate->email)->send(new CertificateMail($certificate->fresh(), $pdfPath));

        $certificate->update([
            'send_status' => 'Sent',
            'sent_at' => now(),
            'send_error' => null,
        ]);

        Log::info('SendCertificateMail: sent', [
            'certificate_id' => $certificate->id,
            'reference' => $certificate->reference,
            'email' => $certificate->email,
        ]);
    }

    /**
     * Record why a send finally failed, so the Certificates screen can show it.
     */
    public function failed(?\Throwable $exception): void
    {
        Certificate::withTrashed()
            ->whereKey($this->certificateId)
            ->update([
                'send_status' => 'Failed',
                'send_error' => \Illuminate\Support\Str::limit($exception?->getMessage() ?? 'Unknown error', 500),
            ]);

        Log::error('SendCertificateMail: job failed', [
            'certificate_id' => $this->certificateId,
            'error' => $exception?->getMessage(),
        ]);
    }
}