# Azure OpenAI via Cloudflare AI Gateway - PowerShell Example
# ============================================================
# IMPORTANT: This uses the PROVIDER-NATIVE endpoint, NOT the Cloudflare REST API.
# The Cloudflare dashboard only shows OpenAI examples, not Azure OpenAI examples.
# Azure OpenAI requires additional URL segments and query parameters.

# --- 1. ACCOUNT_ID ---
# Source: Cloudflare dashboard > Compute > Workers > right sidebar > Account ID
# Format: 32-character hex string
$accountId = 'YOUR_ACCOUNT_ID'

# --- 2. GATEWAY_ID ---
# Source: Cloudflare dashboard > AI > AI Gateway > click your gateway > URL bar or page header
# This is the NAME you gave the gateway (e.g., "ai-cost-demo", "luis", "prod-gateway")
# Format: String name, NOT a UUID
$gatewayId = 'YOUR_GATEWAY_NAME'

# --- 3. AZURE_RESOURCE_NAME ---
# Source: Azure Portal > Azure OpenAI Service > your resource > Overview > Endpoint
# Example endpoint: https://cf-test-srp.openai.azure.com/
# Resource name is the part before ".openai.azure.com"
$resourceName = 'YOUR_AZURE_RESOURCE_NAME'

# --- 4. AZURE_DEPLOYMENT_NAME ---
# Source: Azure Portal > Azure OpenAI Service > your resource > Model deployments
# OR: Azure AI Foundry > your project > Deployments
# This is the NAME you gave the deployment (e.g., "gpt-4", "my-deployment", "prod-gpt4")
# Note: This is NOT the model ID (like "gpt-4"), it's the deployment name you chose
$deploymentName = 'YOUR_DEPLOYMENT_NAME'

# --- 5. CF_AIG_TOKEN ---
# Source: Cloudflare dashboard > AI > AI Gateway > your gateway > Settings > Authentication
# This is a Cloudflare API Token with "AI Gateway - Read" permission
# Create one at: dash.cloudflare.com > My Profile > API Tokens > Create Token
$cfAigToken = 'YOUR_CF_AIG_TOKEN'

# --- 6. API_VERSION ---
# Source: Azure documentation, or check what version your Azure deployment supports
# Common values: "2024-02-01", "2023-05-15", "2024-06-01"
# Optional: Check Azure Portal > your deployment for recommended API version
$apiVersion = '2024-02-01'

# --- Build the URL ---
# Structure: gateway.ai.cloudflare.com/v1/{account}/{gateway}/azure-openai/{resource}/{deployment}/chat/completions
# WHY THIS URL: This is the provider-native endpoint. It tells Cloudflare to proxy to Azure
# using your stored BYOK key. If you use api.cloudflare.com/... instead, it triggers
# Unified Billing and asks for credits!
$uri = "https://gateway.ai.cloudflare.com/v1/$accountId/$gatewayId/azure-openai/$resourceName/$deploymentName/chat/completions?api-version=$apiVersion"

Write-Host "URL: $uri" -ForegroundColor Cyan

# --- Build headers ---
# cf-aig-authorization: Authenticates YOU to Cloudflare AI Gateway
# Content-Type: Required for JSON payload
$headers = @{
    'cf-aig-authorization' = "Bearer $cfAigToken"
    'Content-Type'         = 'application/json'
}

# Note: Do NOT include 'api-key' header when using BYOK!
# Cloudflare injects the stored Azure key automatically.
#
# --- KEY ALIAS (Optional) ---
# Source: Cloudflare dashboard > AI > AI Gateway > your gateway > Provider Keys
# By default, Cloudflare looks for the key with alias "default".
# If your Azure key was saved with a different alias (e.g., "production", "azure-key-1"),
# you MUST add the cf-aig-byok-alias header:
#
#   $headers['cf-aig-byok-alias'] = 'production'
#
# If no alias header is passed, and no "default" alias exists, the request will fail
# or fall back to Unified Billing (asking for credits).
#
# To check your alias: Dashboard > AI Gateway > Provider Keys > look at "Alias" column.
# If you see "default", no extra header needed. If you see anything else, add it above.

# --- Build the request body ---
# Azure OpenAI uses the same chat completions format as OpenAI
# No "model" field needed - Azure knows the model from the deployment name in the URL
$body = @{
    messages = @(
        @{
            role    = 'user'
            content = 'Explain Cloudflare Workers in one sentence.'
        }
    )
} | ConvertTo-Json -Depth 3

# --- Send request ---
try {
    Write-Host "`nSending request..." -ForegroundColor Yellow
    $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
    
    Write-Host "`n=== SUCCESS ===" -ForegroundColor Green
    Write-Host "Response: $($response.choices[0].message.content)"
    
    # Optional: Show token usage
    if ($response.usage) {
        Write-Host "`nUsage:" -ForegroundColor Gray
        Write-Host "  Prompt tokens: $($response.usage.prompt_tokens)"
        Write-Host "  Completion tokens: $($response.usage.completion_tokens)"
        Write-Host "  Total tokens: $($response.usage.total_tokens)"
    }
} 
catch {
    Write-Host "`n=== ERROR ===" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    
    # Try to extract error body
    if ($_.ErrorDetails) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    } 
    else {
        Write-Host "Message: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`nTroubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Verify all 6 values above are correct" -ForegroundColor Yellow
    Write-Host "2. Confirm Azure deployment exists and has quota" -ForegroundColor Yellow
    Write-Host "3. Check that BYOK key is saved in Cloudflare dashboard with 'default' alias" -ForegroundColor Yellow
    Write-Host "4. Ensure you're using 'gateway.ai.cloudflare.com' NOT 'api.cloudflare.com'" -ForegroundColor Yellow
}
