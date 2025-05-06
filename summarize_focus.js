import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import dotenv from 'dotenv';

// --- Configuration ---
dotenv.config(); // Load .env file

// Check for output directory - for compatibility with app.js
const OUTPUT_DIR = path.join(process.cwd(), 'output');
// Ensure it exists
if (!fs.existsSync(OUTPUT_DIR)) {
    try {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created output directory: ${OUTPUT_DIR}`);
    } catch (err) {
        console.warn(`Note: Could not create output directory: ${err.message}`);
        // Not a fatal error, will use original location as fallback
    }
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY not found in environment variables. Please set it in your .env file.");
    process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Default prompt for focused summaries if no custom prompt is provided
const DEFAULT_PROMPT = "Analyze the following transcript. What is the best positioning for someone holding 7 figures in stablecoins according to the discussion? What potential risks or things should they watch out for based on the transcript's content? Provide a concise summary based on these points.";

// --- Helper Function ---

/**
 * Summarizes the text using Anthropic Claude Sonnet with a focused prompt.
 * @param {string} text - The full transcript text.
 * @param {string} customPrompt - Optional custom prompt to use instead of default.
 * @returns {Promise<string|null>} - The summary text or null on error.
 */
async function summarizeWithFocus(text, customPrompt = null) {
    if (!text || text.trim().length === 0) {
        console.log("No text provided for summarization.");
        return null;
    }

    // Use the custom prompt if provided, otherwise use the default
    const focusPrompt = customPrompt || DEFAULT_PROMPT;

    console.log(`Summarizing the transcript (${text.length} characters) with focus prompt...`);
    try {
        const msg = await anthropic.messages.create({
            model: "claude-3-sonnet-20240229",
            max_tokens: 2048, // Adjust as needed, maybe more for detailed analysis
            system: "You are a helpful financial analysis assistant. Analyze the provided transcript based on the user's specific questions.",
            messages: [
                {
                    role: "user",
                    content: `${focusPrompt}\n\n--BEGIN TRANSCRIPT--\n${text}\n--END TRANSCRIPT--`
                }
            ]
        });
        console.log("Summarization API call successful.");

        // Extract text from the response content block(s)
        if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
             const summaryText = msg.content
                 .filter(block => block.type === 'text')
                 .map(block => block.text)
                 .join('\n');

             if (summaryText) {
                  console.log("Focused summary extracted successfully.");
                  return summaryText;
             } else {
                  console.warn("Warning: No text blocks found in the summary response content.");
                  console.warn("Raw content:", msg.content);
                  return "Could not extract summary. No text blocks found.";
             }
        } else {
            console.warn("Warning: No content block found in the summary response.");
            console.warn("Raw response:", msg);
            return "Could not extract summary. No content returned.";
        }
    } catch (error) {
        console.error(`An unexpected error occurred during focused summarization: ${error.message || error}`);
         if (error instanceof Anthropic.APIError) {
            console.error(`Anthropic API Error: Status ${error.status}, Type: ${error.type}`);
            console.error("Details:", error.message);
        }
        return null;
    }
}

/**
 * Main function
 * @param {string} transcriptFilePath
 * @param {object} options
 */
async function main(transcriptFilePath, options = {}) {
    console.log(`Reading transcript file: ${transcriptFilePath}`);
    let transcriptContent = '';
    try {
        if (!fs.existsSync(transcriptFilePath)) {
             throw new Error(`Transcript file not found at ${transcriptFilePath}`);
        }
        transcriptContent = fs.readFileSync(transcriptFilePath, { encoding: 'utf-8' });
        console.log(`Successfully read ${transcriptContent.length} characters from transcript.`);
    } catch (err) {
        console.error(`Error reading transcript file: ${err.message}`);
        process.exit(1);
    }

    const absoluteTranscriptPath = path.resolve(transcriptFilePath);
    const parsedPath = path.parse(absoluteTranscriptPath);
    const outputBaseName = parsedPath.name.replace(/_transcript$/, ''); // Remove _transcript suffix if present
    
    // Determine output directory and filename
    let outputDir = path.dirname(absoluteTranscriptPath); // Default to same location as transcript
    let summaryFilename;
    
    // If called from app.js or explicitly using --output flag, use OUTPUT_DIR
    if (options.useOutputDir || (fs.existsSync(OUTPUT_DIR) && options.forceOutputDir)) {
        outputDir = OUTPUT_DIR;
    }
    
    summaryFilename = path.join(outputDir, `${outputBaseName}_focused_summary.txt`);
    
    // --- Summarization --- 
    // If a custom prompt was specified, use it
    if (options.customPrompt) {
        console.log("Using custom analysis prompt:");
        console.log(`"${options.customPrompt}"`);
    } else {
        console.log("Using default stablecoin analysis prompt.");
    }
    
    const summary = await summarizeWithFocus(transcriptContent, options.customPrompt);

    // --- Save Summary --- 
    if (summary) {
        try {
            fs.writeFileSync(summaryFilename, summary, { encoding: 'utf-8' });
            console.log(`Focused summary saved to: ${summaryFilename}`);
        } catch (e) {
            console.error(`Error saving focused summary to ${summaryFilename}: ${e}`);
        }
    } else {
        console.warn("Focused summarization failed or produced no output. Summary file not saved.");
    }

    console.log("\nProcessing complete.");
    return summaryFilename; // Return the path for potential use by calling code
}

// --- Command Line Interface ---
program
    .version('1.0.0')
    .description("Summarize an existing transcript file using Anthropic Claude with a specific financial focus.")
    .argument('<transcript_file>', "Path to the input transcript text file (e.g., recording_transcript.txt)")
    .option('-o, --output', 'Save to output directory')
    .option('-f, --force-output', 'Force saving to output directory even if called from external script')
    .option('-c, --custom-prompt <prompt>', 'Custom analysis prompt to use instead of the default stablecoin prompt')
    .addHelpText('after', `
Examples:
  node summarize_focus.js ./my_recording_transcript.txt
  node summarize_focus.js -c "What are the main investment themes discussed?" ./transcript.txt
  node summarize_focus.js "C:\\Users\\user\\Downloads\\5-4-25 NVO Inflection and Bear Market Rally As Earnings Season Ends_transcript.txt"

Requirements:
  - Node.js (v18+ recommended)
  - Anthropic API key set in a .env file:
    ANTHROPIC_API_KEY="sk-ant-..."
  - Dependencies installed (npm install)
`)
    .action((transcriptFile, cmdOptions) => {
        main(transcriptFile, {
            useOutputDir: cmdOptions.output || false,
            forceOutputDir: cmdOptions.forceOutput || false,
            customPrompt: cmdOptions.customPrompt || null
        }).catch(err => {
            console.error("Unhandled error in main execution:", err);
            process.exit(1);
        });
    });

program.parse(process.argv);

// Handle case where no arguments are provided
if (!program.args.length) {
    program.help();
}

// For potential programmatic usage
export { summarizeWithFocus, main }; 