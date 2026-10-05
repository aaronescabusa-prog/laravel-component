<?php

namespace App\Services;

use App\Models\Certificate;
use App\Models\CertificateTemplate;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Facades\Storage;

/**
 * Renders a certificate PDF from an uploaded template.
 *
 * The uploaded artwork becomes the page background and the participant's name
 * is drawn on top of it, so an administrator can design a template in any
 * editor and drop it in without touching code.
 */
class CertificateRenderer
{
    /**
     * Build the PDF binary for a certificate.
     *
     * Falls back to a built-in layout when the event has no uploaded
     * template, so the feature still produces a usable certificate.
     */
    public function render(Certificate $certificate, ?CertificateTemplate $template = null): string
    {
        $view = view('certificates.certificate', [
            'certificate' => $certificate,
            'background' => $this->backgroundDataUri($template),
            'institution' => \App\Models\Setting::value('general.institution')
                ?? \App\Models\Setting::value('general.system_name')
                ?? 'Trinidad Municipal College',
        ]);

        return Pdf::loadView('certificates.certificate', $view->getData())
            ->setPaper($this->paperSize($template), 'landscape')
            ->setOption('isRemoteEnabled', false)
            ->setOption('isHtml5ParserEnabled', true)
            ->output();
    }

    /**
     * Absolute path where the rendered PDF should be cached on disk.
     */
    public function storagePath(Certificate $certificate): string
    {
        return "certificates/{$certificate->reference}.pdf";
    }

    /**
     * Render and persist, returning the stored PDF path.
     */
    public function store(Certificate $certificate, ?CertificateTemplate $template = null): string
    {
        $path = $this->storagePath($certificate);

        Storage::disk('public')->put($path, $this->render($certificate, $template));

        return $path;
    }

    /**
     * Public URL of a previously rendered PDF.
     */
    public function publicUrl(string $path): string
    {
        return Storage::disk('public')->url($path);
    }

    /**
     * Read the artwork into a base64 data URI so dompdf can embed it without
     * needing remote/file access.
     */
    private function backgroundDataUri(?CertificateTemplate $template): ?string
    {
        if (! $template) {
            return null;
        }

        $disk = Storage::disk('public');

        if (! $disk->exists($template->path)) {
            return null;
        }

        $mime = $disk->mimeType($template->path) ?: 'image/png';
        $bytes = $disk->get($template->path);

        return 'data:'.$mime.';base64,'.base64_encode($bytes);
    }

    /**
     * Paper size in millimetres, derived from the template's pixel dimensions.
     *
     * dompdf expects a four-element array [width, height, 0, 0] and swaps the
     * last two entries for landscape, so they must be present.
     *
     * @return array{0: float, 1: float, 2: float, 3: float}
     */
    private function paperSize(?CertificateTemplate $template): array
    {
        if (! $template || $template->width < 1 || $template->height < 1) {
            // A4 landscape
            return [297.0, 210.0, 0.0, 0.0];
        }

        // 96dpi -> millimetres, so the artwork is not distorted.
        return [
            round($template->width / 96 * 25.4, 2),
            round($template->height / 96 * 25.4, 2),
            0.0,
            0.0,
        ];
    }
}