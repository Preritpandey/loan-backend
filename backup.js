// backup.js - Automated backup script
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
const DB_NAME = 'loanapp';

// Create backup directory if it doesn't exist
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}`;
}

async function createBackup() {
  const timestamp = formatDate(new Date());
  const backupPath = path.join(BACKUP_DIR, `backup_${timestamp}`);
  
  console.log(`🔄 Starting backup at ${new Date().toISOString()}`);
  console.log(`📁 Backup location: ${backupPath}`);

  return new Promise((resolve, reject) => {
    const command = `mongodump --db ${DB_NAME} --out ${backupPath}`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Backup failed:', error);
        reject(error);
        return;
      }
      
      console.log('✅ Backup completed successfully');
      console.log(`📦 Backup size: ${getFolderSize(backupPath)} MB`);
      resolve(backupPath);
    });
  });
}

function getFolderSize(folderPath) {
  let totalSize = 0;
  
  function calculateSize(dirPath) {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        calculateSize(filePath);
      } else {
        totalSize += stats.size;
      }
    });
  }
  
  try {
    calculateSize(folderPath);
    return (totalSize / (1024 * 1024)).toFixed(2);
  } catch (error) {
    return '0';
  }
}

function cleanOldBackups() {
  console.log(`🧹 Cleaning backups older than ${RETENTION_DAYS} days`);
  
  const backups = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  let deletedCount = 0;
  
  backups.forEach(backup => {
    const backupPath = path.join(BACKUP_DIR, backup);
    const stats = fs.statSync(backupPath);
    const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    
    if (ageInDays > RETENTION_DAYS) {
      console.log(`🗑️  Deleting old backup: ${backup} (${Math.floor(ageInDays)} days old)`);
      fs.rmSync(backupPath, { recursive: true, force: true });
      deletedCount++;
    }
  });
  
  if (deletedCount === 0) {
    console.log('✅ No old backups to delete');
  } else {
    console.log(`✅ Deleted ${deletedCount} old backup(s)`);
  }
}

function listBackups() {
  console.log('\n📋 Available backups:');
  console.log('─'.repeat(70));
  
  const backups = fs.readdirSync(BACKUP_DIR)
    .map(name => {
      const backupPath = path.join(BACKUP_DIR, name);
      const stats = fs.statSync(backupPath);
      return {
        name,
        path: backupPath,
        size: getFolderSize(backupPath),
        date: stats.mtime
      };
    })
    .sort((a, b) => b.date - a.date);
  
  if (backups.length === 0) {
    console.log('No backups found');
    return;
  }
  
  backups.forEach((backup, index) => {
    const ageInDays = Math.floor((Date.now() - backup.date.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`${index + 1}. ${backup.name}`);
    console.log(`   Size: ${backup.size} MB | Age: ${ageInDays} days | Date: ${backup.date.toLocaleString()}`);
  });
  
  console.log('─'.repeat(70));
  console.log(`Total backups: ${backups.length}`);
}

async function restoreBackup(backupName) {
  const backupPath = path.join(BACKUP_DIR, backupName, DB_NAME);
  
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Backup not found: ${backupName}`);
    return;
  }
  
  console.log(`🔄 Restoring backup: ${backupName}`);
  console.log('⚠️  WARNING: This will replace all current data!');
  
  return new Promise((resolve, reject) => {
    const command = `mongorestore --db ${DB_NAME} --drop ${backupPath}`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Restore failed:', error);
        reject(error);
        return;
      }
      
      console.log('✅ Restore completed successfully');
      resolve();
    });
  });
}

// Command line interface
const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  try {
    switch (command) {
      case 'create':
      case 'backup':
        await createBackup();
        cleanOldBackups();
        break;
        
      case 'list':
        listBackups();
        break;
        
      case 'clean':
        cleanOldBackups();
        break;
        
      case 'restore':
        if (!arg) {
          console.error('❌ Please specify backup name');
          console.log('Usage: node backup.js restore <backup_name>');
          listBackups();
          return;
        }
        await restoreBackup(arg);
        break;
        
      default:
        console.log('📦 Loan Management System - Backup Utility\n');
        console.log('Usage:');
        console.log('  node backup.js create         - Create new backup');
        console.log('  node backup.js list           - List all backups');
        console.log('  node backup.js clean          - Clean old backups');
        console.log('  node backup.js restore <name> - Restore from backup');
        console.log('\nExample:');
        console.log('  node backup.js create');
        console.log('  node backup.js restore backup_20241011_1430');
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// If running directly (not imported)
if (require.main === module) {
  main();
}

// Export for use in cron jobs or other scripts
module.exports = {
  createBackup,
  cleanOldBackups,
  listBackups,
  restoreBackup
};