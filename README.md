# Voice Transcription and Summarization App

This application transcribes audio files (including long recordings) and generates summaries of the content. It also provides specialized summaries focused on stablecoin investment strategies.

## Features

- Transcribe audio files of any length (splits large files automatically)
- Generate general summaries of the transcribed content
- Create focused summaries for stablecoin investment positioning and risk analysis
- Process files individually or in batch
- Organize inputs and outputs in dedicated folders
- Interactive menu interface

## Setup Instructions

### Prerequisites

1. **Node.js**: v18 or higher (download from [nodejs.org](https://nodejs.org/))
2. **FFmpeg**: Required for audio processing 
   - Windows: FFmpeg has been installed via Winget on your system
   - Path set to: `C:\Users\user\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1.1-full_build\bin`

### API Keys

You need two API keys to use this application:

1. **AssemblyAI API Key**: For audio transcription
   - Get a free key at [assemblyai.com](https://www.assemblyai.com/)

2. **Anthropic API Key**: For summaries using Claude Sonnet
   - Get a key at [console.anthropic.com](https://console.anthropic.com/)

### Installation

1. Clone or download this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the project root with your API keys:
   ```
   ASSEMBLYAI_API_KEY=your_assemblyai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   ```

## Usage

### Folder Structure

- `audio-input/`: Place audio files here for batch processing
- `output/`: All generated transcripts and summaries are saved here

### Interactive Mode (Recommended)

Run the app in interactive mode:

```
node app.js
```

This will show a menu with options to:
1. Process all audio files in the input folder
2. Process a specific audio file (by path)
3. Generate a focused summary for an existing transcript
4. Show help/instructions
5. Exit

### Command Line Options

Process all audio files in the input folder:
```
node app.js --all
```

Process a specific file:
```
node app.js --file "C:\path\to\your\audio.mp3"
```

Include the `--summary` flag to generate focused stablecoin summaries:
```
node app.js --all --summary
```

### Individual Scripts

You can also run the individual scripts directly:

Transcribe and summarize an audio file:
```
node transcribeSummarize.js "path/to/audio.mp3"
```

Generate a focused stablecoin summary from an existing transcript:
```
node summarize_focus.js "path/to/transcript.txt"
```

## Supported Audio Formats

- MP3 (.mp3)
- WAV (.wav)
- FLAC (.flac)
- AAC (.aac)
- M4A (.m4a)
- OGG (.ogg)

## Troubleshooting

- **FFmpeg issues**: Make sure ffmpeg is properly installed and the path is correctly set in the script.
- **API errors**: Verify your API keys in the `.env` file.
- **Large files**: Very large audio files may take significant time to process.

## License

ISC 