# Simple YT Downloader - Code Signing Script
# This script creates a self-signed code signing certificate and signs your executable

param(
    [Parameter(Mandatory=$false)]
    [string]$CertificatePassword = "YourPassword123!",
    
    [Parameter(Mandatory=$false)]
    [string]$ExePath = ".\dist\Video Downloader Gemini-win32-x64\SimpleYTDownloaderSetup.exe",
    
    [Parameter(Mandatory=$false)]
    [string]$CertificateName = "Simple YT Downloader Code Signing Certificate"
)

# Function to write colored output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    
    $colorMap = @{
        "Red" = "Red"
        "Green" = "Green"
        "Yellow" = "Yellow"
        "Blue" = "Blue"
        "Cyan" = "Cyan"
        "Magenta" = "Magenta"
        "White" = "White"
    }
    
    if ($colorMap.ContainsKey($Color)) {
        Write-Host $Message -ForegroundColor $colorMap[$Color]
    } else {
        Write-Host $Message
    }
}

# Function to check if running as Administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to check prerequisites
function Test-Prerequisites {
    Write-ColorOutput "Checking prerequisites..." "Blue"
    
    # Check PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-ColorOutput "ERROR: PowerShell 5.0 or higher is required." "Red"
        return $false
    }
    
    # Check .NET Framework
    try {
        $null = [System.Security.Cryptography.X509Certificates.X509Certificate2]
    } catch {
        Write-ColorOutput "ERROR: .NET Framework is required for certificate operations." "Red"
        return $false
    }
    
    # Check if signtool.exe is available
    $signtoolPath = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if (-not $signtoolPath) {
        Write-ColorOutput "WARNING: signtool.exe not found in PATH. Will attempt to locate it..." "Yellow"
        
        # Try to find signtool in common locations
        $possiblePaths = @(
            "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe",
            "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe",
            "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe",
            "${env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\signtool.exe",
            "${env:ProgramFiles}\Windows Kits\10\bin\x64\signtool.exe"
        )
        
        $signtoolPath = $possiblePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
        
        if ($signtoolPath) {
            Write-ColorOutput "Found signtool.exe at: $signtoolPath" "Green"
            $env:PATH += ";$(Split-Path $signtoolPath)"
        } else {
            Write-ColorOutput "ERROR: signtool.exe not found. Please install Windows SDK or Visual Studio Build Tools." "Red"
            return $false
        }
    }
    
    Write-ColorOutput "Prerequisites check passed!" "Green"
    return $true
}

# Function to create self-signed certificate
function New-CodeSigningCertificate {
    Write-ColorOutput "Creating self-signed code signing certificate..." "Blue"
    
    try {
        $cert = New-SelfSignedCertificate `
            -Type Custom `
            -Subject "CN=$CertificateName" `
            -KeyUsage DigitalSignature `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -Provider "Microsoft Enhanced RSA and AES Cryptographic Provider" `
            -NotBefore (Get-Date) `
            -NotAfter (Get-Date).AddYears(3) `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -KeyExportPolicy Exportable `
            -KeySpec Signature `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
        
        Write-ColorOutput "Certificate created successfully!" "Green"
        Write-ColorOutput "Thumbprint: $($cert.Thumbprint)" "Cyan"
        Write-ColorOutput "Subject: $($cert.Subject)" "Cyan"
        Write-ColorOutput "Valid from: $($cert.NotBefore) to $($cert.NotAfter)" "Cyan"
        
        return $cert
    } catch {
        Write-ColorOutput "ERROR: Failed to create certificate: $($_.Exception.Message)" "Red"
        return $null
    }
}

# Function to export certificate as PFX
function Export-CertificateAsPFX {
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
    )
    
    Write-ColorOutput "Exporting certificate as PFX file..." "Blue"
    
    try {
        $pfxPath = ".\Simple_YT_Downloader_Code_Signing_Certificate.pfx"
        $pfxBytes = $Certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $CertificatePassword)
        [System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)
        
        Write-ColorOutput "Certificate exported successfully to: $pfxPath" "Green"
        return $pfxPath
    } catch {
        Write-ColorOutput "ERROR: Failed to export certificate: $($_.Exception.Message)" "Red"
        return $null
    }
}

# Function to sign executable
function Sign-Executable {
    param(
        [string]$ExePath,
        [string]$CertificateThumbprint
    )
    
    Write-ColorOutput "Signing executable with certificate..." "Blue"
    
    # Check if executable exists
    if (-not (Test-Path $ExePath)) {
        Write-ColorOutput "ERROR: Executable not found at: $ExePath" "Red"
        return $false
    }
    
    try {
        # Use signtool to sign the executable with specific thumbprint
        $signtoolArgs = @(
            "sign",
            "/sha1", $CertificateThumbprint,
            "/fd", "SHA256",
            "/tr", "http://timestamp.digicert.com",
            "/td", "SHA256",
            $ExePath
        )
        
        Write-ColorOutput "Running: signtool.exe $($signtoolArgs -join ' ')" "Cyan"
        
        $result = & signtool.exe @signtoolArgs 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-ColorOutput "Executable signed successfully!" "Green"
            return $true
        } else {
            Write-ColorOutput "ERROR: Failed to sign executable. Exit code: $LASTEXITCODE" "Red"
            Write-ColorOutput "Output: $result" "Red"
            return $false
        }
    } catch {
        Write-ColorOutput "ERROR: Failed to sign executable: $($_.Exception.Message)" "Red"
        return $false
    }
}

# Function to test file signature
function Test-FileSignature {
    param(
        [string]$FilePath
    )
    
    Write-ColorOutput "Verifying file signature..." "Blue"
    
    try {
        $signature = Get-AuthenticodeSignature -FilePath $FilePath
        
        switch ($signature.Status) {
            "Valid" {
                Write-ColorOutput "✅ Signature is VALID!" "Green"
                Write-ColorOutput "Signer: $($signature.SignerCertificate.Subject)" "Cyan"
                Write-ColorOutput "Timestamp: $($signature.TimeStamperCertificate.Subject)" "Cyan"
                return $true
            }
            "NotSigned" {
                Write-ColorOutput "❌ File is NOT SIGNED" "Red"
                return $false
            }
            "HashMismatch" {
                Write-ColorOutput "❌ Signature HASH MISMATCH" "Red"
                return $false
            }
            "NotTrusted" {
                Write-ColorOutput "⚠️  Signature is NOT TRUSTED (expected for self-signed)" "Yellow"
                Write-ColorOutput "Signer: $($signature.SignerCertificate.Subject)" "Cyan"
                return $true
            }
            default {
                Write-ColorOutput "⚠️  Signature status: $($signature.Status)" "Yellow"
                return $false
            }
        }
    } catch {
        Write-ColorOutput "ERROR: Failed to verify signature: $($_.Exception.Message)" "Red"
        return $false
    }
}

# Function to create batch file for future signing
function New-SigningBatchFile {
    param(
        [string]$CertificateThumbprint,
        [string]$ExePath
    )
    
    $batchContent = @"
@echo off
echo === Simple YT Downloader - Quick Re-signing ===
echo.

REM Check if executable exists
if not exist "$ExePath" (
    echo ERROR: Executable not found at: $ExePath
    echo Please update the path in this batch file.
    pause
    exit /b 1
)

echo Signing executable with existing certificate...
echo Certificate Thumbprint: $CertificateThumbprint
echo.

REM Sign the executable
signtool.exe sign /sha1 $CertificateThumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 "$ExePath"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ Executable signed successfully!
    echo.
    echo Verifying signature...
    powershell.exe -Command "Get-AuthenticodeSignature -FilePath '$ExePath' | Select-Object Status, SignerCertificate"
) else (
    echo.
    echo ❌ Failed to sign executable. Error code: %ERRORLEVEL%
)

echo.
pause
"@
    
    $batchPath = ".\sign-executable.bat"
    $batchContent | Out-File -FilePath $batchPath -Encoding ASCII
    
    Write-ColorOutput "Created batch file for future signing: $batchPath" "Green"
    Write-ColorOutput "You can use this file to re-sign your executable without running the full script." "Cyan"
}

# Main execution
function Main {
    Write-ColorOutput "=== Simple YT Downloader - Code Signing Script ===" "Magenta"
    Write-ColorOutput "This script will create a self-signed certificate and sign your executable" "White"
    Write-ColorOutput ""
    
    # Check if running as Administrator
    if (-not (Test-Administrator)) {
        Write-ColorOutput "WARNING: This script requires Administrator privileges for certificate creation." "Yellow"
        Write-ColorOutput "Please run PowerShell as Administrator and try again." "Yellow"
        Write-ColorOutput ""
        Write-ColorOutput "To run as Administrator:" "Cyan"
        Write-ColorOutput "1. Right-click on PowerShell" "White"
        Write-ColorOutput "2. Select 'Run as administrator'" "White"
        Write-ColorOutput "3. Navigate to this directory and run the script again" "White"
        return
    }
    
    # Check prerequisites
    if (-not (Test-Prerequisites)) {
        return
    }
    
    # Create certificate
    $certificate = New-CodeSigningCertificate
    if (-not $certificate) {
        return
    }
    
    # Export certificate
    $pfxPath = Export-CertificateAsPFX -Certificate $certificate
    if (-not $pfxPath) {
        return
    }
    
    # Sign executable
    if (-not (Sign-Executable -ExePath $ExePath -CertificateThumbprint $certificate.Thumbprint)) {
        Write-ColorOutput "Failed to sign executable. Exiting." "Red"
        return
    }
    
    # Test signature
    Test-FileSignature -FilePath $ExePath
    
    # Create batch file for future use
    New-SigningBatchFile -CertificateThumbprint $certificate.Thumbprint -ExePath $ExePath
    
    Write-ColorOutput ""
    Write-ColorOutput "=== Code Signing Complete! ===" "Green"
    Write-ColorOutput ""
    Write-ColorOutput "Summary:" "Cyan"
    Write-ColorOutput "• Certificate created and stored in CurrentUser store" "White"
    Write-ColorOutput "• Certificate exported to: $pfxPath" "White"
    Write-ColorOutput "• Executable signed: $ExePath" "White"
    Write-ColorOutput "• Future signing batch file created: sign-executable.bat" "White"
    Write-ColorOutput ""
    Write-ColorOutput "Note: Self-signed certificates will show as 'Not Trusted' in Windows." "Yellow"
    Write-ColorOutput "This is normal and expected for development/testing purposes." "Yellow"
}

# Run the main function
Main
